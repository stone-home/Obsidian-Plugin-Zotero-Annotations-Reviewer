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
	DigestVocabItem,
	activeVocab,
	resolveDigestSettings,
} from '../services/digest-types';
import {
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

type Mode = 'card' | 'accept' | 'reject' | 'rejected' | 'accepted' | 'invalid';
type UndoStep = { kind: 'reject' | 'later'; key: string; queue: string[] };

/** The Paper Digest triage window: one paper at a time, accept or reject. */
export class PaperDigestView extends ItemView {
	private readonly svc: DigestServices;
	private queue: string[] = [];
	private batch = '';
	private mode: Mode = 'card';
	private zotero: ZoteroStatus = { state: 'offline' };
	private translateOnline = false;
	private storeError = '';
	private picked = new Set<string>();
	private collectionKey = '';
	private busy = false;
	private error = '';
	private offerBasic = false;
	private undo: UndoStep | null = null;

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
		this.rebuildQueue();
		this.render();
	}

	private async checkServices(): Promise<void> {
		const [zotero, translateOnline] = await Promise.all([
			this.svc.zotero.status(),
			this.svc.translate.ping(),
		]);
		this.zotero = zotero;
		this.translateOnline = translateOnline;
		if (zotero.state === 'online') {
			const keys = zotero.collections.map((collection) => collection.key);
			const last = this.svc.settings().lastCollectionKey;
			if (!keys.includes(this.collectionKey)) {
				this.collectionKey = keys.includes(last) ? last : '';
			}
		}
	}

	private rebuildQueue(): void {
		this.queue = this.svc.store
			.list('unchecked')
			.filter((record) => !this.batch || record.batch === this.batch)
			.map((record) => record.key);
		this.undo = null;
	}

	private current(): DigestRecord | undefined {
		return this.queue.length ? this.svc.store.get(this.queue[0]) : undefined;
	}

	private canTriage(): boolean {
		return (
			!this.busy &&
			!this.storeError &&
			this.zotero.state === 'online' &&
			this.translateOnline &&
			this.current() !== undefined
		);
	}

	private directions(): DigestVocabItem[] {
		return activeVocab(this.svc.settings().directions);
	}

	private reasons(): DigestVocabItem[] {
		return activeVocab(this.svc.settings().rejectReasons);
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
		const valid = new Set(this.directions().map((item) => item.id));
		this.picked = new Set(
			this.svc.settings().lastDirections.filter((id) => valid.has(id))
		);
		this.setMode('accept');
	}

	private startReject(): void {
		if (this.canTriage()) this.setMode('reject');
	}

	private later(): void {
		if (!this.canTriage() || this.queue.length < 2) return;
		this.undo = { kind: 'later', key: this.queue[0], queue: [...this.queue] };
		this.queue.push(this.queue.shift() as string);
		this.setMode('card');
	}

	private async reject(reasonId: string): Promise<void> {
		const record = this.current();
		if (!record || !this.canTriage()) return;
		const step: UndoStep = {
			kind: 'reject',
			key: record.key,
			queue: [...this.queue],
		};
		await this.persist(() => this.svc.store.reject(record.key, reasonId));
		this.queue.shift();
		this.undo = step;
		this.setMode('card');
	}

	private async confirmAccept(basic = false): Promise<void> {
		const record = this.current();
		if (!record || !this.canTriage()) return;
		if (this.picked.size === 0) {
			this.error = 'Pick at least one direction.';
			this.render();
			return;
		}
		const settings = this.svc.settings();
		const directions = Array.from(this.picked);
		const collection =
			this.zotero.state === 'online'
				? this.zotero.collections.find(
						(item) => item.key === this.collectionKey
					)
				: undefined;

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
			this.collectionKey,
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
				collection: {
					key: this.collectionKey,
					name: collection?.path ?? 'Library root',
				},
				zoteroKey: result.key,
			})
		);
		await this.svc.updateSettings({
			lastDirections: directions,
			lastCollectionKey: this.collectionKey,
		});
		this.queue.shift();
		this.undo = null;
		this.setMode('card');
	}

	private async undoLast(): Promise<void> {
		const step = this.undo;
		if (!step) return;
		if (step.kind === 'reject') {
			await this.persist(() => this.svc.store.restore(step.key));
		}
		this.queue = step.queue;
		this.undo = null;
		this.setMode('card');
	}

	private async restore(key: string): Promise<void> {
		await this.persist(() => this.svc.store.restore(key));
		this.rebuildQueue();
		this.render();
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
		this.rebuildQueue();
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
			this.rebuildQueue();
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
		bind('ArrowDown', () => this.mode === 'card' && this.later());
		bind('Enter', () => this.mode === 'accept' && void this.confirmAccept());
		bind('Escape', () => this.mode !== 'card' && this.setMode('card'));
		for (let digit = 1; digit <= 9; digit++) {
			bind(String(digit), () => this.pickByDigit(digit - 1));
		}
	}

	private pickByDigit(index: number): void {
		if (this.mode === 'accept') {
			const item = this.directions()[index];
			if (item) this.toggleDirection(item.id);
		} else if (this.mode === 'reject') {
			const item = this.reasons()[index];
			if (item) void this.reject(item.id);
		}
	}

	private toggleDirection(id: string): void {
		if (this.picked.has(id)) this.picked.delete(id);
		else this.picked.add(id);
		this.error = '';
		this.render();
	}

	// --- Rendering -----------------------------------------------------------

	private render(): void {
		const root = this.contentEl;
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
		if (
			this.mode === 'rejected' ||
			this.mode === 'accepted' ||
			this.mode === 'invalid'
		) {
			this.renderList(root, this.mode);
			return;
		}
		this.renderCard(root);
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
		const batches = this.svc.store.batches();
		if (batches.length > 0 || this.batch) {
			const select = right.createEl('select', { cls: 'dropdown' });
			select.createEl('option', { text: 'All imports', value: '' });
			for (const name of batches)
				select.createEl('option', { text: name, value: name });
			select.value = this.batch;
			select.onchange = () => {
				this.batch = select.value;
				this.rebuildQueue();
				this.setMode('card');
			};
		}
		right.createSpan({
			cls: 'zotero-digest-count',
			text: `${this.queue.length} unchecked`,
		});
		const menuButton = right.createEl('button', {
			text: '⋯',
			cls: 'clickable-icon',
		});
		menuButton.setAttr('aria-label', 'More');
		menuButton.onclick = (evt) => this.openMenu(evt);
	}

	private openMenu(evt: MouseEvent): void {
		const counts = this.svc.store.counts();
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
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(`Rejected (${counts.rejected})`)
				.onClick(() => this.setMode('rejected'))
		);
		menu.addItem((item) =>
			item
				.setTitle(`Accepted (${counts.accepted})`)
				.onClick(() => this.setMode('accepted'))
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

	private renderCard(root: HTMLElement): void {
		const record = this.current();
		if (!record) {
			root.createDiv({ cls: 'zotero-digest-empty', text: 'Nothing to check.' });
			this.renderUndo(root);
			return;
		}
		const card = root.createDiv({ cls: 'zotero-digest-card' });
		card.createEl('h3', { cls: 'zotero-digest-title', text: record.title });
		const meta = card.createDiv({ cls: 'zotero-digest-meta' });
		const parts = [record.venue, record.year?.toString(), record.item_type].filter(
			Boolean
		);
		if (parts.length) meta.createSpan({ text: parts.join(' · ') });
		const href = record.url ?? (record.doi ? `https://doi.org/${record.doi}` : '');
		if (href) meta.createEl('a', { text: record.doi ?? record.url, href });
		if (record.batch)
			meta.createSpan({ cls: 'zotero-digest-batch', text: record.batch });
		card.createDiv({
			cls: 'zotero-digest-abstract',
			text: record.abstract ?? 'No abstract.',
		});

		const enabled = this.canTriage();
		const actions = root.createDiv({ cls: 'zotero-digest-actions' });
		const button = (text: string, cls: string, onClick: () => void) => {
			const el = actions.createEl('button', { text, cls });
			el.disabled = !enabled;
			el.onclick = onClick;
		};
		button('✗ Reject ←', 'mod-warning', () => this.startReject());
		button('Later ↓', '', () => this.later());
		button('✓ Accept →', 'mod-cta', () => this.startAccept());
		this.renderUndo(root);

		if (this.mode === 'accept') this.renderAcceptPanel(root, record);
		if (this.mode === 'reject') this.renderRejectPanel(root);
	}

	private renderUndo(root: HTMLElement): void {
		if (!this.undo) return;
		const row = root.createDiv({ cls: 'zotero-digest-undo' });
		const undo = row.createEl('button', { text: '↶ Undo' });
		undo.onclick = () => void this.undoLast();
	}

	private renderAcceptPanel(root: HTMLElement, record: DigestRecord): void {
		const panel = root.createDiv({ cls: 'zotero-digest-panel' });
		panel.createDiv({
			cls: 'zotero-digest-panel-title',
			text: 'Accept: directions',
		});
		const directions = this.directions();
		if (directions.length === 0) {
			panel.createDiv({
				cls: 'zotero-digest-hint',
				text: 'No directions defined. Add them in Settings → Digest.',
			});
		}
		const chips = panel.createDiv({ cls: 'zotero-digest-chips' });
		directions.forEach((item, index) => {
			const chip = chips.createEl('button', {
				cls: 'zotero-digest-chip',
				text: `${index + 1} ${item.label || item.id}`,
			});
			chip.toggleClass('is-picked', this.picked.has(item.id));
			chip.onclick = () => this.toggleDirection(item.id);
		});

		const row = panel.createDiv({ cls: 'zotero-digest-row' });
		row.createSpan({ text: 'Collection' });
		const select = row.createEl('select', { cls: 'dropdown' });
		select.createEl('option', { text: 'Library root', value: '' });
		if (this.zotero.state === 'online') {
			for (const collection of this.zotero.collections) {
				select.createEl('option', {
					text: collection.path,
					value: collection.key,
				});
			}
		}
		select.value = this.collectionKey;
		select.onchange = () => {
			this.collectionKey = select.value;
		};

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

	private renderRejectPanel(root: HTMLElement): void {
		const panel = root.createDiv({ cls: 'zotero-digest-panel' });
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

	private renderList(
		root: HTMLElement,
		mode: 'rejected' | 'accepted' | 'invalid'
	): void {
		const titles = {
			rejected: 'Rejected',
			accepted: 'Accepted',
			invalid: 'Invalid lines',
		};
		const bar = root.createDiv({ cls: 'zotero-digest-list-bar' });
		const back = bar.createEl('button', { text: '← Back' });
		back.onclick = () => this.setMode('card');
		bar.createSpan({ cls: 'zotero-digest-panel-title', text: titles[mode] });
		const list = root.createDiv({ cls: 'zotero-digest-list' });

		if (mode === 'invalid') {
			const lines = this.svc.store.invalidLines();
			if (lines.length > 0) {
				const clear = bar.createEl('button', { text: 'Clear' });
				clear.onclick = async () => {
					await this.persist(() => this.svc.store.clearInvalid());
					this.render();
				};
			}
			for (const line of lines) {
				const row = list.createDiv({ cls: 'zotero-digest-list-row' });
				row.createDiv({ text: `${line.file}: ${line.reason}` });
				row.createDiv({
					cls: 'zotero-digest-raw',
					text: line.raw.slice(0, 300),
				});
			}
			if (lines.length === 0)
				list.createDiv({ cls: 'zotero-digest-empty', text: 'None.' });
			return;
		}

		const reasonLabels = new Map(
			this.svc
				.settings()
				.rejectReasons.map((item) => [item.id, item.label || item.id])
		);
		const records = this.svc.store
			.list(mode)
			.sort((a, b) => (b.decided_at ?? '').localeCompare(a.decided_at ?? ''));
		for (const record of records) {
			const row = list.createDiv({ cls: 'zotero-digest-list-row' });
			row.createDiv({ cls: 'zotero-digest-list-title', text: record.title });
			const detail = row.createDiv({ cls: 'zotero-digest-meta' });
			const day = (record.decided_at ?? '').slice(0, 10);
			if (mode === 'rejected') {
				const reason = record.reject_reason ?? '';
				detail.createSpan({
					text: `${reasonLabels.get(reason) ?? reason} · ${day}`,
				});
				const restore = detail.createEl('button', { text: 'Restore' });
				restore.onclick = () => void this.restore(record.key);
			} else {
				const where = record.collection?.name ?? '';
				const tags = (record.directions ?? []).join(', ');
				detail.createSpan({
					text: [where, tags, day].filter(Boolean).join(' · '),
				});
				if (record.zotero_key) {
					detail.createEl('a', {
						text: 'Show in Zotero',
						href: `zotero://select/library/items/${record.zotero_key}`,
					});
				}
			}
		}
		if (records.length === 0)
			list.createDiv({ cls: 'zotero-digest-empty', text: 'None.' });
	}
}

/** Opens the Paper Digest window (or reveals the open one) and runs an import. */
export async function openDigest(plugin: ZoteroGKPlugin): Promise<void> {
	const { workspace } = plugin.app;
	let leaf = workspace.getLeavesOfType(VIEW_TYPE_DIGEST)[0];
	if (!leaf) {
		leaf = workspace.openPopoutLeaf({ size: { width: 760, height: 860 } });
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
