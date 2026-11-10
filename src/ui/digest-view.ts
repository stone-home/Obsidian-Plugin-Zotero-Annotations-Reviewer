import {
	ItemView,
	Menu,
	Notice,
	Platform,
	Scope,
	WorkspaceLeaf,
	normalizePath,
	requestUrl,
} from 'obsidian';
import type ZoteroGKPlugin from '../main';
import { bibToInputs } from '../services/digest-bib';
import { importIncoming, ingest } from '../services/digest-import';
import { DigestStore } from '../services/digest-store';
import { TranslationClient } from '../services/digest-translate';
import {
	DigestFiles,
	DigestHttp,
	DigestRecord,
	DigestSettings,
	DigestStatus,
	DigestVocabItem,
	activeVocab,
	resolveDigestSettings,
} from '../services/digest-types';
import {
	ZoteroCollection,
	ZoteroLocalClient,
	ZoteroStatus,
	acceptRecord,
	directionTags,
} from '../services/digest-zotero';

/** View type id of the Paper Digest window. */
export const VIEW_TYPE_DIGEST = 'zotero-paper-digest';

const SECRET_ID = 'zotero-digest-local-api-key';
const DOCKER_HINT =
	'docker run -d --name zotero-translation --restart unless-stopped ' +
	'-p 127.0.0.1:1969:1969 zotero/translation-server';

/** HTTP function for the digest clients, backed by Obsidian's `requestUrl`. */
export const digestHttp: DigestHttp = async (request) => {
	const response = await requestUrl({ ...request, throw: false });
	return { status: response.status, text: response.text, headers: response.headers };
};

/** Everything the digest window and settings tab work with. */
export type DigestServices = {
	settings(): DigestSettings;
	updateSettings(patch: Partial<DigestSettings>): Promise<void>;
	files: DigestFiles;
	store: DigestStore;
	translate: TranslationClient;
	zotero: ZoteroLocalClient;
};

const servicesByPlugin = new WeakMap<ZoteroGKPlugin, DigestServices>();
const ribbonByPlugin = new WeakMap<ZoteroGKPlugin, HTMLElement>();

/** Returns the digest services of a plugin instance, creating them once. */
export function getDigestServices(plugin: ZoteroGKPlugin): DigestServices {
	const existing = servicesByPlugin.get(plugin);
	if (existing) return existing;

	const { app } = plugin;
	const adapter = app.vault.adapter;
	const settings = () => resolveDigestSettings(plugin.settings.digest);
	const updateSettings = async (patch: Partial<DigestSettings>) => {
		plugin.settings.digest = { ...settings(), ...patch };
		await plugin.saveSettings();
	};
	const files: DigestFiles = {
		exists: (path) => adapter.exists(path),
		read: (path) => adapter.read(path),
		write: (path, data) => adapter.write(path, data),
		remove: (path) => adapter.remove(path),
		list: async (folder) => (await adapter.list(folder)).files,
		mkdir: (folder) => adapter.mkdir(folder),
	};
	const pluginDir =
		plugin.manifest.dir ?? `${app.vault.configDir}/plugins/${plugin.manifest.id}`;
	const secrets = app.secretStorage;

	const created: DigestServices = {
		settings,
		updateSettings,
		files,
		store: new DigestStore(files, normalizePath(`${pluginDir}/digest-store.json`)),
		translate: new TranslationClient(
			digestHttp,
			() => settings().translationServerUrl
		),
		zotero: new ZoteroLocalClient(digestHttp, () => plugin.settings.zoteroPort, {
			get: async () =>
				(secrets ? secrets.getSecret(SECRET_ID) : settings().zoteroApiKey) ||
				null,
			set: async (key) => {
				if (secrets) secrets.setSecret(SECRET_ID, key ?? '');
				else await updateSettings({ zoteroApiKey: key ?? '' });
			},
		}),
	};
	servicesByPlugin.set(plugin, created);
	return created;
}

type Mode = 'card' | 'accept' | 'reject' | 'invalid';
type StatusFilter = 'all' | DigestStatus;

const STATUS_LABELS: Record<DigestStatus, string> = {
	unchecked: 'Unchecked',
	accepted: 'Accepted',
	rejected: 'Rejected',
};

/**
 * The Paper Digest triage window: a scrollable list of all papers with their
 * status on the left, and the selected paper with its actions on the right.
 */
export class PaperDigestView extends ItemView {
	private readonly svc: DigestServices;
	private filter: StatusFilter = 'all';
	private batch = '';
	private selectedKey = '';
	private mode: Mode = 'card';
	private zotero: ZoteroStatus = { state: 'offline' };
	private translateOnline = false;
	private storeError = '';
	private pickedDirections = new Set<string>();
	private pickedCollections = new Set<string>();
	private busy = false;
	private error = '';
	private offerBasic = false;
	private listScroll = 0;

	constructor(leaf: WorkspaceLeaf, plugin: ZoteroGKPlugin) {
		super(leaf);
		this.svc = getDigestServices(plugin);
		this.scope = new Scope(this.app.scope);
		this.registerKeys();
	}

	getViewType(): string {
		return VIEW_TYPE_DIGEST;
	}

	getDisplayText(): string {
		return 'Paper Digest';
	}

	getIcon(): string {
		return 'inbox';
	}

	/** Renders from the store only; importing is left to an explicit open or Refresh. */
	async onOpen(): Promise<void> {
		await this.reload(false);
	}

	/**
	 * Reloads the store and service status, then renders.
	 * @param doImport also import the incoming folder and run cleanup first.
	 */
	async reload(doImport: boolean): Promise<void> {
		const { store, files, settings } = this.svc;
		this.storeError = '';
		try {
			await store.load();
			if (doImport) {
				const folder = normalizePath(settings().incomingFolder);
				const summary = await importIncoming(files, store, folder);
				const expired = store.cleanup(settings().retentionDays);
				await store.save();
				new Notice(
					`Paper Digest: ${summary.added} new, ${summary.duplicates} duplicate, ` +
						`${summary.invalid} invalid, ${expired} expired.`
				);
			}
		} catch (e) {
			console.error('[Paper Digest] reload failed', e);
			this.storeError = (e as Error).message;
		}
		await this.checkServices();
		this.ensureSelection();
		this.render();
	}

	private async checkServices(): Promise<void> {
		const [zotero, translateOnline] = await Promise.all([
			this.svc.zotero.status(),
			this.svc.translate.ping(),
		]);
		this.zotero = zotero;
		this.translateOnline = translateOnline;
	}

	// --- Selection -----------------------------------------------------------

	/** Papers shown in the list: unchecked first, then the most recent decisions. */
	private visible(): DigestRecord[] {
		const { store } = this.svc;
		const statuses: DigestStatus[] =
			this.filter === 'all'
				? ['unchecked', 'accepted', 'rejected']
				: [this.filter];
		const decided = (records: DigestRecord[]) =>
			records.sort((a, b) =>
				(b.decided_at ?? '').localeCompare(a.decided_at ?? '')
			);
		const records: DigestRecord[] = [];
		if (statuses.includes('unchecked')) records.push(...store.list('unchecked'));
		records.push(
			...decided(
				statuses
					.filter((status) => status !== 'unchecked')
					.flatMap((status) => store.list(status))
			)
		);
		return records.filter((record) => !this.batch || record.batch === this.batch);
	}

	private selected(): DigestRecord | undefined {
		return this.selectedKey ? this.svc.store.get(this.selectedKey) : undefined;
	}

	private ensureSelection(): void {
		const records = this.visible();
		if (records.some((record) => record.key === this.selectedKey)) return;
		this.selectedKey = records[0]?.key ?? '';
	}

	private select(key: string): void {
		this.selectedKey = key;
		this.setMode('card');
	}

	private move(step: number): void {
		const records = this.visible();
		if (records.length === 0) return;
		const index = records.findIndex((record) => record.key === this.selectedKey);
		const next = Math.min(records.length - 1, Math.max(0, index + step));
		this.select(records[next].key);
	}

	/** After a decision, moves to the next unchecked paper below, or the first one. */
	private selectNextUnchecked(after: DigestRecord[], index: number): void {
		const unchecked = (record: DigestRecord) =>
			this.svc.store.get(record.key)?.status === 'unchecked';
		const next = after.slice(index + 1).find(unchecked) ?? after.find(unchecked);
		if (next) this.selectedKey = next.key;
		this.ensureSelection();
	}

	private canTriage(): boolean {
		return (
			!this.busy &&
			!this.storeError &&
			this.zotero.state === 'online' &&
			this.translateOnline &&
			this.selected()?.status === 'unchecked'
		);
	}

	private directions(): DigestVocabItem[] {
		return activeVocab(this.svc.settings().directions);
	}

	private reasons(): DigestVocabItem[] {
		return activeVocab(this.svc.settings().rejectReasons);
	}

	private collections(): ZoteroCollection[] {
		return this.zotero.state === 'online' ? this.zotero.collections : [];
	}

	// --- Actions -------------------------------------------------------------

	private setMode(mode: Mode): void {
		this.mode = mode;
		this.error = '';
		this.offerBasic = false;
		this.render();
	}

	private startAccept(): void {
		if (!this.canTriage()) return;
		const settings = this.svc.settings();
		const directions = new Set(this.directions().map((item) => item.id));
		const collections = new Set(this.collections().map((item) => item.key));
		this.pickedDirections = new Set(
			settings.lastDirections.filter((id) => directions.has(id))
		);
		this.pickedCollections = new Set(
			settings.lastCollectionKeys.filter((key) => collections.has(key))
		);
		this.setMode('accept');
	}

	private startReject(): void {
		if (this.canTriage()) this.setMode('reject');
	}

	private async reject(reasonId: string): Promise<void> {
		const record = this.selected();
		if (!record || !this.canTriage()) return;
		const before = this.visible();
		const index = before.findIndex((item) => item.key === record.key);
		await this.persist(() => this.svc.store.reject(record.key, reasonId));
		this.selectNextUnchecked(before, index);
		this.setMode('card');
	}

	private async confirmAccept(basic = false): Promise<void> {
		const record = this.selected();
		if (!record || !this.canTriage()) return;
		if (this.directions().length > 0 && this.pickedDirections.size === 0) {
			this.error = 'Pick at least one direction above, then confirm.';
			this.render();
			return;
		}
		const settings = this.svc.settings();
		const directions = Array.from(this.pickedDirections);
		const collections = this.collections()
			.filter((item) => this.pickedCollections.has(item.key))
			.map((item) => ({ key: item.key, name: item.path }));
		const collectionKeys = collections.map((item) => item.key);
		const before = this.visible();
		const index = before.findIndex((item) => item.key === record.key);

		this.busy = true;
		this.error = '';
		this.render();
		const result = await acceptRecord(
			{
				lookup: (identifier) => this.svc.translate.search(identifier),
				createItem: (item) => this.svc.zotero.createItem(item),
			},
			record,
			directionTags(settings.tagPrefix, directions),
			collectionKeys,
			basic
		);
		this.busy = false;

		if (!result.ok) {
			this.error = result.reason;
			this.offerBasic = result.canSaveBasic;
			await this.checkServices();
			this.render();
			return;
		}
		await this.persist(() =>
			this.svc.store.accept(record.key, {
				directions,
				collections,
				zoteroKey: result.key,
			})
		);
		await this.svc.updateSettings({
			lastDirections: directions,
			lastCollectionKeys: collectionKeys,
		});
		this.selectNextUnchecked(before, index);
		this.setMode('card');
	}

	/** Returns a decided paper to unchecked. An accepted item stays in Zotero. */
	private async undo(key: string): Promise<void> {
		const record = this.svc.store.get(key);
		if (!record || record.status === 'unchecked') return;
		const wasAccepted = record.status === 'accepted';
		await this.persist(() => this.svc.store.restore(key));
		if (wasAccepted) {
			new Notice(
				'Paper Digest: restored to unchecked. The item already created in Zotero was not removed.'
			);
		}
		this.selectedKey = key;
		this.ensureSelection();
		this.setMode('card');
	}

	private async withdrawBatch(): Promise<void> {
		const batch = this.batch;
		if (!batch) return;
		let removed = 0;
		await this.persist(() => {
			removed = this.svc.store.withdrawBatch(batch);
		});
		new Notice(`Paper Digest: withdrew ${removed} unchecked papers of ${batch}.`);
		this.batch = '';
		this.ensureSelection();
		this.render();
	}

	private async importBib(file: File): Promise<void> {
		try {
			const { inputs, skipped } = bibToInputs(await file.text());
			const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
			const batch = `bib-${file.name.replace(/\.bib$/i, '')}-${stamp}`;
			let counts = { added: 0, duplicates: 0 };
			await this.persist(() => {
				counts = ingest(this.svc.store, inputs, batch);
			});
			new Notice(
				`Paper Digest: ${counts.added} new, ${counts.duplicates} duplicate, ` +
					`${skipped} without identifier (${file.name}).`
			);
			this.ensureSelection();
			this.render();
		} catch (e) {
			console.error('[Paper Digest] bib import failed', e);
			new Notice(`Paper Digest: bib import failed: ${(e as Error).message}`);
		}
	}

	/** Applies a change to the store and writes it to disk, reporting failures. */
	private async persist(change: () => void): Promise<void> {
		try {
			change();
			await this.svc.store.save();
		} catch (e) {
			console.error('[Paper Digest] save failed', e);
			new Notice(`Paper Digest: could not save: ${(e as Error).message}`);
		}
	}

	// --- Keys ----------------------------------------------------------------

	private registerKeys(): void {
		const bind = (key: string, handler: () => void) => {
			this.scope?.register([], key, (evt) => {
				const target = evt.target as HTMLElement | null;
				if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
				handler();
				return false;
			});
		};
		bind('ArrowLeft', () => this.mode === 'card' && this.startReject());
		bind('ArrowRight', () => this.mode === 'card' && this.startAccept());
		bind('ArrowDown', () => this.mode !== 'invalid' && this.move(1));
		bind('ArrowUp', () => this.mode !== 'invalid' && this.move(-1));
		bind('Enter', () => this.mode === 'accept' && void this.confirmAccept());
		bind('Escape', () => this.mode !== 'card' && this.setMode('card'));
		for (let digit = 1; digit <= 9; digit++) {
			bind(String(digit), () => this.pickByDigit(digit - 1));
		}
	}

	private pickByDigit(index: number): void {
		if (this.mode === 'accept') {
			const item = this.directions()[index];
			if (item) this.toggle(this.pickedDirections, item.id);
		} else if (this.mode === 'reject') {
			const item = this.reasons()[index];
			if (item) void this.reject(item.id);
		}
	}

	private toggle(set: Set<string>, id: string): void {
		if (set.has(id)) set.delete(id);
		else set.add(id);
		this.error = '';
		this.render();
	}

	// --- Rendering -----------------------------------------------------------

	private render(): void {
		const root = this.contentEl;
		const oldList = root.querySelector('.zotero-digest-list');
		if (oldList) this.listScroll = oldList.scrollTop;
		root.empty();
		root.addClass('zotero-digest');
		this.renderHeader(root);
		if (this.storeError) {
			root.createDiv({
				cls: 'zotero-digest-alert',
				text: `The digest store could not be read: ${this.storeError}`,
			});
			return;
		}
		this.renderServiceAlert(root);
		if (this.mode === 'invalid') {
			this.renderInvalid(root);
			return;
		}
		const body = root.createDiv({ cls: 'zotero-digest-body' });
		this.renderList(body);
		this.renderDetail(body.createDiv({ cls: 'zotero-digest-detail' }));
	}

	private renderHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: 'zotero-digest-header' });
		const dot = (label: string, online: boolean) => {
			const el = header.createSpan({ cls: 'zotero-digest-status', text: label });
			el.toggleClass('is-online', online);
			el.toggleClass('is-offline', !online);
		};
		dot('Zotero', this.zotero.state === 'online');
		dot('Translation server', this.translateOnline);

		const right = header.createDiv({ cls: 'zotero-digest-header-right' });
		const counts = this.svc.store.counts();
		const filter = right.createEl('select', { cls: 'dropdown' });
		const total = counts.unchecked + counts.accepted + counts.rejected;
		filter.createEl('option', { text: `All (${total})`, value: 'all' });
		for (const status of ['unchecked', 'accepted', 'rejected'] as DigestStatus[]) {
			filter.createEl('option', {
				text: `${STATUS_LABELS[status]} (${counts[status]})`,
				value: status,
			});
		}
		filter.value = this.filter;
		filter.onchange = () => {
			this.filter = filter.value as StatusFilter;
			this.ensureSelection();
			this.setMode('card');
		};

		const batches = this.svc.store.batches();
		if (batches.length > 0 || this.batch) {
			const select = right.createEl('select', { cls: 'dropdown' });
			select.createEl('option', { text: 'All imports', value: '' });
			for (const name of batches)
				select.createEl('option', { text: name, value: name });
			select.value = this.batch;
			select.onchange = () => {
				this.batch = select.value;
				this.ensureSelection();
				this.setMode('card');
			};
		}
		const menuButton = right.createEl('button', {
			text: '⋯',
			cls: 'clickable-icon',
		});
		menuButton.setAttr('aria-label', 'More');
		menuButton.onclick = (evt) => this.openMenu(evt);
	}

	private openMenu(evt: MouseEvent): void {
		const invalid = this.svc.store.invalidLines().length;
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle('Refresh')
				.setIcon('refresh-cw')
				.onClick(() => void this.reload(true))
		);
		menu.addItem((item) =>
			item
				.setTitle('Import .bib')
				.setIcon('file-up')
				.onClick(() => this.pickBibFile())
		);
		menu.addItem((item) =>
			item
				.setTitle(`Invalid lines (${invalid})`)
				.onClick(() => this.setMode('invalid'))
		);
		if (this.batch) {
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(`Withdraw import: ${this.batch}`)
					.setIcon('trash')
					.onClick(() => void this.withdrawBatch())
			);
		}
		menu.showAtMouseEvent(evt);
	}

	private pickBibFile(): void {
		const input = this.contentEl.createEl('input', {
			cls: 'zotero-digest-hidden',
			attr: { type: 'file', accept: '.bib' },
		});
		input.onchange = () => {
			const file = input.files?.[0];
			input.remove();
			if (file) void this.importBib(file);
		};
		input.click();
	}

	private renderServiceAlert(root: HTMLElement): void {
		const messages: string[] = [];
		if (this.zotero.state === 'offline') {
			messages.push('Zotero is not running. Open Zotero, then Recheck.');
		} else if (this.zotero.state === 'disabled') {
			messages.push(
				'Zotero local API is off. In Zotero: Settings → Advanced → allow other ' +
					'applications on this computer to communicate with Zotero.'
			);
		} else if (this.zotero.state === 'error') {
			messages.push(this.zotero.message);
		}
		if (!this.translateOnline) {
			const url = this.svc.settings().translationServerUrl;
			messages.push(
				`Translation server not reachable at ${url}. Start it with: ${DOCKER_HINT}`
			);
		}
		if (messages.length === 0) return;
		const alert = root.createDiv({ cls: 'zotero-digest-alert' });
		for (const message of messages) alert.createDiv({ text: message });
		const recheck = alert.createEl('button', { text: 'Recheck' });
		recheck.onclick = async () => {
			await this.checkServices();
			this.render();
		};
	}

	private renderList(body: HTMLElement): void {
		const list = body.createDiv({ cls: 'zotero-digest-list' });
		const records = this.visible();
		if (records.length === 0) {
			list.createDiv({ cls: 'zotero-digest-empty', text: 'No papers.' });
			return;
		}
		let selectedRow: HTMLElement | null = null;
		for (const record of records) {
			const row = list.createDiv({ cls: 'zotero-digest-list-row' });
			if (record.key === this.selectedKey) {
				row.addClass('is-selected');
				selectedRow = row;
			}
			row.onclick = () => this.select(record.key);
			const text = row.createDiv({ cls: 'zotero-digest-list-text' });
			text.createDiv({ cls: 'zotero-digest-list-title', text: record.title });
			const parts = [record.venue, record.year?.toString()].filter(Boolean);
			if (parts.length) {
				text.createDiv({ cls: 'zotero-digest-meta', text: parts.join(' · ') });
			}
			const side = row.createDiv({ cls: 'zotero-digest-list-side' });
			side.createSpan({
				cls: `zotero-digest-badge is-${record.status}`,
				text: STATUS_LABELS[record.status],
			});
			if (record.status !== 'unchecked') {
				const undo = side.createEl('button', { text: 'Undo' });
				undo.onclick = (evt) => {
					evt.stopPropagation();
					void this.undo(record.key);
				};
			}
		}
		list.scrollTop = this.listScroll;
		selectedRow?.scrollIntoView({ block: 'nearest' });
	}

	private renderDetail(detail: HTMLElement): void {
		const record = this.selected();
		if (!record) {
			detail.createDiv({ cls: 'zotero-digest-empty', text: 'Select a paper.' });
			return;
		}
		const card = detail.createDiv({ cls: 'zotero-digest-card' });
		card.createEl('h3', { cls: 'zotero-digest-title', text: record.title });
		const meta = card.createDiv({ cls: 'zotero-digest-meta' });
		const parts = [record.venue, record.year?.toString(), record.item_type].filter(
			Boolean
		);
		if (parts.length) meta.createSpan({ text: parts.join(' · ') });
		const href = record.url ?? (record.doi ? `https://doi.org/${record.doi}` : '');
		if (href) meta.createEl('a', { text: record.doi ?? record.url, href });
		if (record.batch) meta.createSpan({ text: record.batch });
		card.createDiv({
			cls: 'zotero-digest-abstract',
			text: record.abstract ?? 'No abstract.',
		});

		if (record.status !== 'unchecked') {
			this.renderDecision(detail, record);
			return;
		}
		const enabled = this.canTriage();
		const actions = detail.createDiv({ cls: 'zotero-digest-actions' });
		const button = (text: string, cls: string, onClick: () => void) => {
			const el = actions.createEl('button', { text, cls });
			el.disabled = !enabled;
			el.onclick = onClick;
		};
		button('✗ Reject ←', 'mod-warning', () => this.startReject());
		button('✓ Accept →', 'mod-cta', () => this.startAccept());

		if (this.mode === 'accept') this.renderAcceptPanel(detail, record);
		if (this.mode === 'reject') this.renderRejectPanel(detail);
	}

	private renderDecision(detail: HTMLElement, record: DigestRecord): void {
		const panel = detail.createDiv({ cls: 'zotero-digest-panel' });
		const day = (record.decided_at ?? '').slice(0, 10);
		if (record.status === 'rejected') {
			const labels = new Map(
				this.svc
					.settings()
					.rejectReasons.map((item) => [item.id, item.label || item.id])
			);
			const reason = record.reject_reason ?? '';
			panel.createDiv({
				text: `Rejected: ${labels.get(reason) ?? reason} · ${day}`,
			});
		} else {
			const where =
				(record.collections ?? []).map((item) => item.name).join(', ') ||
				'Library root';
			panel.createDiv({ text: `Accepted · ${day}` });
			panel.createDiv({
				cls: 'zotero-digest-meta',
				text: `Collections: ${where}`,
			});
			panel.createDiv({
				cls: 'zotero-digest-meta',
				text: `Directions: ${(record.directions ?? []).join(', ') || 'none'}`,
			});
			if (record.zotero_key) {
				panel.createEl('a', {
					text: 'Show in Zotero',
					href: `zotero://select/library/items/${record.zotero_key}`,
				});
			}
		}
		const undo = panel.createEl('button', { text: '↶ Undo (back to unchecked)' });
		undo.onclick = () => void this.undo(record.key);
	}

	private renderAcceptPanel(detail: HTMLElement, record: DigestRecord): void {
		const panel = detail.createDiv({ cls: 'zotero-digest-panel' });
		panel.createDiv({ cls: 'zotero-digest-panel-title', text: 'Directions' });
		const directions = this.directions();
		if (directions.length === 0) {
			panel.createDiv({
				cls: 'zotero-digest-hint',
				text:
					'No directions are defined, so no direction tag will be written. ' +
					'Add them in Settings → Digest.',
			});
		}
		const chips = panel.createDiv({ cls: 'zotero-digest-chips' });
		directions.forEach((item, index) => {
			const chip = chips.createEl('button', {
				cls: 'zotero-digest-chip',
				text: `${index + 1} ${item.label || item.id}`,
			});
			chip.toggleClass('is-picked', this.pickedDirections.has(item.id));
			chip.onclick = () => this.toggle(this.pickedDirections, item.id);
		});

		panel.createDiv({
			cls: 'zotero-digest-panel-title',
			text: `Collections (${this.pickedCollections.size} selected)`,
		});
		const box = panel.createDiv({ cls: 'zotero-digest-collections' });
		for (const collection of this.collections()) {
			const label = box.createEl('label', { cls: 'zotero-digest-collection' });
			label.style.paddingLeft = `${collection.depth * 16}px`;
			const input = label.createEl('input', { attr: { type: 'checkbox' } });
			input.checked = this.pickedCollections.has(collection.key);
			input.onchange = () => {
				if (input.checked) this.pickedCollections.add(collection.key);
				else this.pickedCollections.delete(collection.key);
				this.render();
			};
			label.createSpan({ text: collection.name });
		}
		if (this.pickedCollections.size === 0) {
			panel.createDiv({
				cls: 'zotero-digest-hint',
				text: 'No collection selected: the item goes to the library root.',
			});
		}
		if (!record.doi) {
			panel.createDiv({
				cls: 'zotero-digest-hint',
				text: 'This paper has no DOI, so Zotero cannot look it up.',
			});
		}
		if (this.error)
			panel.createDiv({ cls: 'zotero-digest-error', text: this.error });

		const buttons = panel.createDiv({ cls: 'zotero-digest-actions' });
		const cancel = buttons.createEl('button', { text: 'Cancel (Esc)' });
		cancel.onclick = () => this.setMode('card');
		if (this.offerBasic) {
			const basic = buttons.createEl('button', {
				text: 'Save with basic metadata',
			});
			basic.disabled = this.busy;
			basic.onclick = () => void this.confirmAccept(true);
		}
		const confirm = buttons.createEl('button', {
			cls: 'mod-cta',
			text: this.busy ? 'Saving…' : 'Confirm (Enter)',
		});
		confirm.disabled = this.busy;
		confirm.onclick = () => void this.confirmAccept();
	}

	private renderRejectPanel(detail: HTMLElement): void {
		const panel = detail.createDiv({ cls: 'zotero-digest-panel' });
		panel.createDiv({ cls: 'zotero-digest-panel-title', text: 'Reject: reason' });
		const chips = panel.createDiv({ cls: 'zotero-digest-chips' });
		this.reasons().forEach((item, index) => {
			const chip = chips.createEl('button', {
				cls: 'zotero-digest-chip',
				text: `${index + 1} ${item.label || item.id}`,
			});
			chip.onclick = () => void this.reject(item.id);
		});
		const cancel = panel.createEl('button', { text: 'Cancel (Esc)' });
		cancel.onclick = () => this.setMode('card');
	}

	private renderInvalid(root: HTMLElement): void {
		const bar = root.createDiv({ cls: 'zotero-digest-list-bar' });
		const back = bar.createEl('button', { text: '← Back' });
		back.onclick = () => this.setMode('card');
		bar.createSpan({ cls: 'zotero-digest-panel-title', text: 'Invalid lines' });
		const lines = this.svc.store.invalidLines();
		if (lines.length > 0) {
			const clear = bar.createEl('button', { text: 'Clear' });
			clear.onclick = async () => {
				await this.persist(() => this.svc.store.clearInvalid());
				this.render();
			};
		}
		const list = root.createDiv({ cls: 'zotero-digest-invalid' });
		for (const line of lines) {
			const row = list.createDiv({ cls: 'zotero-digest-invalid-row' });
			row.createDiv({ text: `${line.file}: ${line.reason}` });
			row.createDiv({ cls: 'zotero-digest-raw', text: line.raw.slice(0, 300) });
		}
		if (lines.length === 0)
			list.createDiv({ cls: 'zotero-digest-empty', text: 'None.' });
	}
}

/** Opens the Paper Digest window (or reveals the open one) and runs an import. */
export async function openDigest(plugin: ZoteroGKPlugin): Promise<void> {
	const { workspace } = plugin.app;
	let leaf = workspace.getLeavesOfType(VIEW_TYPE_DIGEST)[0];
	if (!leaf) {
		leaf = workspace.openPopoutLeaf({ size: { width: 1180, height: 840 } });
		await leaf.setViewState({ type: VIEW_TYPE_DIGEST, active: true });
	}
	await workspace.revealLeaf(leaf);
	if (leaf.view instanceof PaperDigestView) await leaf.view.reload(true);
}

/** Adds or removes the Paper Digest ribbon icon to match the setting. */
export function updateDigestRibbon(plugin: ZoteroGKPlugin): void {
	ribbonByPlugin.get(plugin)?.remove();
	ribbonByPlugin.delete(plugin);
	if (!Platform.isDesktopApp || !getDigestServices(plugin).settings().showInRibbon)
		return;
	const el = plugin.addRibbonIcon('inbox', 'Open Paper Digest', () => {
		void openDigest(plugin);
	});
	ribbonByPlugin.set(plugin, el);
}

/**
 * Registers the Paper Digest view, command and ribbon icon. Desktop only: the
 * window is a popout and talks to the local Zotero.
 */
export function registerDigest(plugin: ZoteroGKPlugin): void {
	if (!Platform.isDesktopApp) return;
	plugin.registerView(VIEW_TYPE_DIGEST, (leaf) => new PaperDigestView(leaf, plugin));
	plugin.addCommand({
		id: 'open-paper-digest',
		name: 'Open Paper Digest',
		callback: () => void openDigest(plugin),
	});
	updateDigestRibbon(plugin);
}
