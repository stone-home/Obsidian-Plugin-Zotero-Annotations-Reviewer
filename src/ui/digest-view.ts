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
import { DEFAULT_SETTINGS } from '../types';
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
import { PaperHubService } from '../services/paper-hub';
import { VaultLibraryService, VaultPaperEntry } from '../services/vault-library';
import { ZoteroConnectorService } from '../services/zotero-connector';
import { ConnectorModal } from './connector-modal';

/** View type id of the Paper Digest & Library window. */
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

type HubTab = 'library' | 'digest';
type Mode = 'card' | 'accept' | 'reject' | 'invalid';
type StatusFilter = 'all' | DigestStatus;
type LibraryQuickFilter = 'all' | 'core' | 'takeaway';

const STATUS_LABELS: Record<DigestStatus, string> = {
	unchecked: 'Unchecked',
	accepted: 'Accepted',
	rejected: 'Rejected',
};

/**
 * Unified Paper Hub window supporting:
 * - `library`: searchable Vault Literature Library with Core Note editing & Connector
 * - `digest`: incoming paper triage & Zotero import
 */
export class PaperDigestView extends ItemView {
	private readonly plugin: ZoteroGKPlugin;
	private readonly svc: DigestServices;
	private fallbackPaperHub: PaperHubService | null = null;
	private fallbackLibrary: VaultLibraryService | null = null;

	private hubTab: HubTab = 'digest';
	private filter: StatusFilter = 'all';
	private batch = '';
	private selectedKey = '';
	private mode: Mode = 'card';
	private zotero: ZoteroStatus = { state: 'offline' };
	private translateOnline = false;
	private storeError = '';
	private pickedDirections = new Set<string>();
	private pickedCollection = '';
	private busy = false;
	private error = '';
	private offerManual = false;
	private detailScroll = 0;
	private collectionScroll = 0;
	private listScroll = 0;

	// --- Library state ---
	private libraryEntries: VaultPaperEntry[] = [];
	private libraryQuery = '';
	private libraryQuickFilter: LibraryQuickFilter = 'all';
	private libraryVenueFilter = '';
	private selectedLibraryKey = '';
	private libraryEditingCore = false;
	private libraryListScroll = 0;
	private libraryDetailScroll = 0;
	private vaultListenersRegistered = false;

	constructor(leaf: WorkspaceLeaf, plugin: ZoteroGKPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.svc = getDigestServices(plugin);
		this.scope = new Scope(this.app.scope);
		this.registerKeys();
	}

	getViewType(): string {
		return VIEW_TYPE_DIGEST;
	}

	getDisplayText(): string {
		return this.hubTab === 'library' ? 'Paper Library' : 'Paper Digest';
	}

	getIcon(): string {
		return 'inbox';
	}

	private getPaperHub(): PaperHubService {
		if (this.plugin.paperHub) return this.plugin.paperHub;
		if (!this.fallbackPaperHub) {
			this.fallbackPaperHub = new PaperHubService(this.app, () =>
				Object.assign({}, DEFAULT_SETTINGS, this.plugin.settings)
			);
		}
		return this.fallbackPaperHub;
	}

	private getVaultLibrary(): VaultLibraryService {
		if (this.plugin.vaultLibrary) return this.plugin.vaultLibrary;
		if (!this.fallbackLibrary) {
			this.fallbackLibrary = new VaultLibraryService(
				this.app,
				() => Object.assign({}, DEFAULT_SETTINGS, this.plugin.settings),
				this.getPaperHub()
			);
		}
		return this.fallbackLibrary;
	}

	private ensureVaultListeners(): void {
		if (this.vaultListenersRegistered) return;
		this.vaultListenersRegistered = true;

		const refreshIfLibraryActive = () => {
			if (this.hubTab !== 'library' || this.libraryEditingCore) return;
			void this.reloadLibrary().then(() => this.renderLibraryResultsOnly());
		};

		if (typeof this.app.vault?.on === 'function') {
			this.registerEvent(
				this.app.vault.on('create', (file) => {
					if (file.path.toLowerCase().endsWith('.md')) {
						refreshIfLibraryActive();
					}
				})
			);
			this.registerEvent(
				this.app.vault.on('modify', (file) => {
					if (file.path.toLowerCase().endsWith('.md')) {
						refreshIfLibraryActive();
					}
				})
			);
			this.registerEvent(
				this.app.vault.on('delete', (file) => {
					if (file.path.toLowerCase().endsWith('.md')) {
						refreshIfLibraryActive();
					}
				})
			);
		}
		if (typeof this.app.metadataCache?.on === 'function') {
			this.registerEvent(
				this.app.metadataCache.on('changed', (file) => {
					if (file.path.toLowerCase().endsWith('.md')) {
						refreshIfLibraryActive();
					}
				})
			);
		}
	}

	private async importFromZotero(): Promise<void> {
		const connector = new ZoteroConnectorService(
			this.app,
			Object.assign({}, DEFAULT_SETTINGS, this.plugin.settings)
		);
		const triggered = await connector.triggerInteractiveImport();
		if (triggered) {
			await this.reloadLibrary();
			this.render();
		}
	}

	/** Renders from the store only; importing is left to an explicit open or Refresh. */
	async onOpen(): Promise<void> {
		this.ensureVaultListeners();
		if (this.hubTab === 'library') {
			await this.reloadLibrary();
			this.render();
			return;
		}
		await this.reload(false);
	}

	/** Opens the Hub directly on the Vault Paper Library tab, optionally pre-filtered by venue. */
	async openLibrary(venueFilter?: string): Promise<void> {
		this.ensureVaultListeners();
		this.hubTab = 'library';
		if (venueFilter !== undefined) {
			this.libraryVenueFilter = venueFilter.trim();
		}
		this.libraryEditingCore = false;
		await this.reloadLibrary();
		this.render();
	}

	/** Switches between Library and Digest tabs. */
	async switchHubTab(tab: HubTab): Promise<void> {
		this.ensureVaultListeners();
		if (this.hubTab === tab) return;
		this.hubTab = tab;
		this.libraryEditingCore = false;
		if (tab === 'library') {
			await this.reloadLibrary();
			this.render();
		} else {
			await this.reload(false);
		}
	}

	async reloadLibrary(): Promise<void> {
		try {
			const lib = this.getVaultLibrary();
			this.libraryEntries = await lib.searchPapers(this.libraryQuery, {
				venue: this.libraryVenueFilter || undefined,
				hasCoreNote: this.libraryQuickFilter === 'core' ? true : undefined,
				hasTakeaway: this.libraryQuickFilter === 'takeaway' ? true : undefined,
			});
		} catch (e) {
			console.error('[Paper Library] reload failed', e);
			this.libraryEntries = [];
		}
		this.ensureLibrarySelection();
	}

	private ensureLibrarySelection(): void {
		if (this.libraryEntries.some((e) => e.citekey === this.selectedLibraryKey)) return;
		this.selectedLibraryKey = this.libraryEntries[0]?.citekey ?? '';
	}

	private selectedLibraryEntry(): VaultPaperEntry | undefined {
		return this.libraryEntries.find((e) => e.citekey === this.selectedLibraryKey);
	}

	private moveLibrary(step: number): void {
		if (this.libraryEntries.length === 0) return;
		const idx = this.libraryEntries.findIndex(
			(e) => e.citekey === this.selectedLibraryKey
		);
		const nextIdx = Math.min(
			this.libraryEntries.length - 1,
			Math.max(0, idx + step)
		);
		this.selectedLibraryKey = this.libraryEntries[nextIdx].citekey;
		this.libraryEditingCore = false;
		this.renderLibraryResultsOnly();
	}

	private openSelectedLibraryNote(): void {
		const selected = this.selectedLibraryEntry();
		if (!selected) return;
		void this.app.workspace.getLeaf(false).openFile(selected.file);
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

	// --- Digest Selection ----------------------------------------------------

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
		const detail = this.contentEl.querySelector('.zotero-digest-detail');
		if (detail) detail.scrollTop = 0;
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

	// --- Digest Actions ------------------------------------------------------

	private setMode(mode: Mode): void {
		this.mode = mode;
		this.error = '';
		this.offerManual = false;
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
		this.pickedCollection =
			settings.lastCollectionKeys.find((key) => collections.has(key)) ?? '';
		this.collectionScroll = 0;
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

	/** The choices of the accept panel, or undefined when a direction is missing. */
	private acceptChoices() {
		if (this.directions().length > 0 && this.pickedDirections.size === 0) {
			this.error = 'Pick at least one direction above, then confirm.';
			this.render();
			return undefined;
		}
		const picked = this.collections().find(
			(item) => item.key === this.pickedCollection
		);
		return {
			directions: Array.from(this.pickedDirections),
			collections: picked ? [{ key: picked.key, name: picked.path }] : [],
		};
	}

	private async confirmAccept(): Promise<void> {
		const record = this.selected();
		if (!record || !this.canTriage()) return;
		const choices = this.acceptChoices();
		if (!choices) return;

		this.busy = true;
		this.error = '';
		this.offerManual = false;
		this.render();
		const result = await acceptRecord(
			{
				lookup: (identifier) => this.svc.translate.search(identifier),
				createItem: (item) => this.svc.zotero.createItem(item),
			},
			record,
			directionTags(this.svc.settings().tagPrefix, choices.directions),
			choices.collections.map((item) => item.key)
		);
		this.busy = false;

		if (!result.ok) {
			this.error = `${result.reason}. Nothing was added to Zotero.`;
			this.offerManual = true;
			await this.checkServices();
			this.render();
			return;
		}
		await this.finishAccept(record, choices, result.key);
	}

	/** Marks the paper accepted without creating a Zotero item. */
	private async acceptManually(): Promise<void> {
		const record = this.selected();
		if (!record || record.status !== 'unchecked' || this.busy) return;
		const choices = this.acceptChoices();
		if (choices) await this.finishAccept(record, choices);
	}

	private async finishAccept(
		record: DigestRecord,
		choices: { directions: string[]; collections: { key: string; name: string }[] },
		zoteroKey?: string
	): Promise<void> {
		const before = this.visible();
		const index = before.findIndex((item) => item.key === record.key);
		await this.persist(() =>
			this.svc.store.accept(record.key, { ...choices, zoteroKey })
		);
		await this.svc.updateSettings({
			lastDirections: choices.directions,
			lastCollectionKeys: choices.collections.map((item) => item.key),
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
		bind('ArrowLeft', () => {
			if (this.hubTab === 'digest' && this.mode === 'card') this.startReject();
		});
		bind('ArrowRight', () => {
			if (this.hubTab === 'digest' && this.mode === 'card') this.startAccept();
		});
		bind('ArrowDown', () => {
			if (this.hubTab === 'library') this.moveLibrary(1);
			else if (this.mode !== 'invalid') this.move(1);
		});
		bind('ArrowUp', () => {
			if (this.hubTab === 'library') this.moveLibrary(-1);
			else if (this.mode !== 'invalid') this.move(-1);
		});
		bind('Enter', () => {
			if (this.hubTab === 'library') this.openSelectedLibraryNote();
			else if (this.mode === 'accept') void this.confirmAccept();
		});
		bind('Escape', () => {
			if (this.hubTab === 'library') {
				if (this.libraryVenueFilter || this.libraryQuery) {
					this.libraryVenueFilter = '';
					this.libraryQuery = '';
					void this.reloadLibrary().then(() => this.render());
				}
			} else if (this.mode !== 'card') {
				this.setMode('card');
			}
		});
		for (let digit = 1; digit <= 9; digit++) {
			bind(String(digit), () => {
				if (this.hubTab === 'digest') this.pickByDigit(digit - 1);
			});
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
		const scrollOf = (selector: string, fallback: number) =>
			root.querySelector(selector)?.scrollTop ?? fallback;
		this.listScroll = scrollOf('.zotero-digest-list', this.listScroll);
		this.detailScroll = scrollOf('.zotero-digest-detail', this.detailScroll);
		this.collectionScroll = scrollOf(
			'.zotero-digest-collections',
			this.collectionScroll
		);
		this.libraryListScroll = scrollOf('.zotero-library-list', this.libraryListScroll);
		this.libraryDetailScroll = scrollOf(
			'.zotero-library-detail',
			this.libraryDetailScroll
		);

		root.empty();
		root.addClass('zotero-digest');
		this.renderHeader(root);

		if (this.hubTab === 'library') {
			this.renderLibraryView(root);
			return;
		}

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
		const detail = body.createDiv({ cls: 'zotero-digest-detail' });
		this.renderDetail(detail);
		detail.scrollTop = this.detailScroll;
	}

	private renderHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: 'zotero-digest-header' });

		// Segmented Hub Switcher [ Library | Digest ]
		const switcher = header.createDiv({ cls: 'zotero-hub-segmented' });
		const libBtn = switcher.createEl('button', {
			cls: 'zotero-hub-seg-btn',
			text: 'Library',
		});
		libBtn.toggleClass('is-active', this.hubTab === 'library');
		libBtn.onclick = () => void this.switchHubTab('library');

		const digestBtn = switcher.createEl('button', {
			cls: 'zotero-hub-seg-btn',
			text: 'Digest',
		});
		digestBtn.toggleClass('is-active', this.hubTab === 'digest');
		digestBtn.onclick = () => void this.switchHubTab('digest');

		if (this.hubTab === 'library') {
			const right = header.createDiv({ cls: 'zotero-digest-header-right' });
			right.createSpan({
				cls: 'zotero-digest-meta',
				text: `${this.libraryEntries.length} paper${this.libraryEntries.length === 1 ? '' : 's'}`,
			});
			const importBtn = right.createEl('button', {
				cls: 'mod-cta zotero-library-import-btn',
				text: '+ Import from Zotero',
				attr: { type: 'button' },
			});
			importBtn.onclick = () => void this.importFromZotero();
			const refreshBtn = right.createEl('button', {
				cls: 'zotero-library-refresh-btn',
				text: '↻ Refresh',
				attr: { type: 'button' },
			});
			refreshBtn.onclick = async () => {
				await this.reloadLibrary();
				this.render();
			};
			return;
		}

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

	// --- Library Rendering ---------------------------------------------------

	private renderLibraryView(root: HTMLElement): void {
		const toolbar = root.createDiv({ cls: 'zotero-library-toolbar' });
		const searchWrap = toolbar.createDiv({ cls: 'zotero-library-search-wrap' });
		const searchInput = searchWrap.createEl('input', {
			cls: 'zotero-library-search-input',
			attr: {
				type: 'search',
				placeholder:
					'Search title, citekey, venue, authors, Core Note, TL;DR...',
			},
		}) as HTMLInputElement;
		searchInput.value = this.libraryQuery;

		const clearBtn = searchWrap.createEl('button', {
			cls: 'zotero-library-search-clear',
			text: '×',
			attr: { type: 'button', title: 'Clear search' },
		});
		clearBtn.toggleClass('zotero-digest-hidden', !this.libraryQuery);

		searchInput.oninput = async () => {
			this.libraryQuery = searchInput.value;
			clearBtn.toggleClass('zotero-digest-hidden', !this.libraryQuery);
			await this.reloadLibrary();
			this.renderLibraryResultsOnly();
		};

		clearBtn.onclick = async () => {
			this.libraryQuery = '';
			searchInput.value = '';
			clearBtn.addClass('zotero-digest-hidden');
			await this.reloadLibrary();
			this.renderLibraryResultsOnly();
			searchInput.focus();
		};

		const filterBar = toolbar.createDiv({ cls: 'zotero-library-filters' });
		const addChip = (id: LibraryQuickFilter, label: string) => {
			const chip = filterBar.createEl('button', {
				cls: 'zotero-library-filter-chip',
				text: label,
				attr: { type: 'button' },
			});
			chip.toggleClass('is-active', this.libraryQuickFilter === id);
			chip.onclick = async () => {
				this.libraryQuickFilter = id;
				await this.reloadLibrary();
				this.render();
			};
		};
		addChip('all', 'All');
		addChip('core', 'Core Note');
		addChip('takeaway', 'Takeaway');

		if (this.libraryVenueFilter) {
			const venueChip = filterBar.createEl('button', {
				cls: 'zotero-library-filter-chip is-venue is-active',
				text: `Venue: ${this.libraryVenueFilter} ×`,
				attr: { type: 'button', title: 'Clear venue filter' },
			});
			venueChip.onclick = async () => {
				this.libraryVenueFilter = '';
				await this.reloadLibrary();
				this.render();
			};
		}

		const resultsRoot = root.createDiv({
			cls: 'zotero-digest-body zotero-library-results',
		});
		this.populateLibraryResults(resultsRoot);
	}

	private renderLibraryResultsOnly(): void {
		const resultsRoot = this.contentEl.querySelector(
			'.zotero-library-results'
		) as HTMLElement | null;
		if (!resultsRoot) {
			this.render();
			return;
		}
		this.libraryListScroll =
			resultsRoot.querySelector('.zotero-library-list')?.scrollTop ??
			this.libraryListScroll;
		this.libraryDetailScroll =
			resultsRoot.querySelector('.zotero-library-detail')?.scrollTop ??
			this.libraryDetailScroll;

		resultsRoot.empty();
		this.populateLibraryResults(resultsRoot);

		const countEl = this.contentEl.querySelector(
			'.zotero-digest-header-right .zotero-digest-meta'
		);
		if (countEl) {
			countEl.textContent = `${this.libraryEntries.length} paper${
				this.libraryEntries.length === 1 ? '' : 's'
			}`;
		}
	}

	private populateLibraryResults(resultsRoot: HTMLElement): void {
		const list = resultsRoot.createDiv({
			cls: 'zotero-digest-list zotero-library-list',
		});

		if (this.libraryEntries.length === 0) {
			const hasActiveFilter = Boolean(
				this.libraryQuery.trim() ||
					this.libraryVenueFilter ||
					this.libraryQuickFilter !== 'all'
			);
			const emptyEl = list.createDiv({
				cls: 'zotero-digest-empty zotero-library-empty',
			});
			emptyEl.createDiv({
				text: hasActiveFilter
					? 'No matching papers in Vault.'
					: 'No papers in Vault yet.',
			});
			if (!hasActiveFilter) {
				const emptyImportBtn = emptyEl.createEl('button', {
					cls: 'mod-cta zotero-library-import-btn',
					text: '+ Import from Zotero',
					attr: { type: 'button' },
				});
				emptyImportBtn.onclick = () => void this.importFromZotero();
			}
		} else {
			let selectedRow: HTMLElement | null = null;
			for (const entry of this.libraryEntries) {
				const row = list.createDiv({
					cls: 'zotero-digest-list-row zotero-library-row',
				});
				if (entry.citekey === this.selectedLibraryKey) {
					row.addClass('is-selected');
					selectedRow = row;
				}
				row.onclick = () => {
					this.selectedLibraryKey = entry.citekey;
					this.libraryEditingCore = false;
					this.libraryDetailScroll = 0;
					this.renderLibraryResultsOnly();
				};

				const textCol = row.createDiv({ cls: 'zotero-digest-list-text' });
				textCol.createDiv({
					cls: 'zotero-digest-list-title',
					text: entry.title,
				});

				const firstAuthor = entry.authors[0]?.replace(/-/g, ' ') ?? '';
				const metaParts = [
					entry.venueSeries || entry.venue,
					entry.year,
					firstAuthor,
				].filter(Boolean);
				if (metaParts.length > 0) {
					textCol.createDiv({
						cls: 'zotero-digest-meta',
						text: metaParts.join(' · '),
					});
				}

				const badgeRow = textCol.createDiv({ cls: 'zotero-library-row-badges' });
				badgeRow.createSpan({
					cls: 'zotero-library-citekey-pill',
					text: entry.citekey,
				});
				if (entry.hasCoreNote) {
					badgeRow.createSpan({ cls: 'zotero-library-mini-badge is-core', text: 'Core' });
				}
				if (entry.hasTakeaway) {
					badgeRow.createSpan({
						cls: 'zotero-library-mini-badge is-takeaway',
						text: 'Takeaway',
					});
				}
				if (entry.hasReport1) {
					badgeRow.createSpan({ cls: 'zotero-library-mini-badge', text: 'R1' });
				}
				if (entry.hasReport2) {
					badgeRow.createSpan({ cls: 'zotero-library-mini-badge', text: 'R2' });
				}
			}
			list.scrollTop = this.libraryListScroll;
			selectedRow?.scrollIntoView({ block: 'nearest' });
		}

		const detail = resultsRoot.createDiv({
			cls: 'zotero-digest-detail zotero-library-detail',
		});
		this.renderLibraryDetail(detail);
		detail.scrollTop = this.libraryDetailScroll;
	}

	private renderLibraryDetail(detail: HTMLElement): void {
		const entry = this.selectedLibraryEntry();
		if (!entry) {
			detail.createDiv({
				cls: 'zotero-digest-empty',
				text: 'Select a paper on the left to inspect its notes and synthesis.',
			});
			return;
		}

		const headerCard = detail.createDiv({ cls: 'zotero-digest-card zotero-library-card' });
		headerCard.createEl('h3', { cls: 'zotero-digest-title', text: entry.title });

		if (entry.authors.length > 0) {
			headerCard.createDiv({
				cls: 'zotero-library-authors',
				text: entry.authors.map((a) => a.replace(/-/g, ' ')).join(', '),
			});
		}

		const metaRow = headerCard.createDiv({ cls: 'zotero-digest-meta zotero-library-meta-row' });
		if (entry.venueSeries || entry.venue) {
			const venueBtn = metaRow.createEl('button', {
				cls: 'zotero-library-venue-pill',
				text: entry.venueSeries || entry.venue,
				attr: { type: 'button', title: 'Filter library by this venue' },
			});
			venueBtn.onclick = async () => {
				this.libraryVenueFilter = entry.venueSeries || entry.venue;
				await this.reloadLibrary();
				this.render();
			};
		}
		if (entry.year) metaRow.createSpan({ text: entry.year });

		const doiHref = entry.doi
			? /^https?:\/\//i.test(entry.doi)
				? entry.doi
				: `https://doi.org/${entry.doi}`
			: entry.url;
		if (doiHref) {
			metaRow.createEl('a', {
				text: entry.doi ? `DOI: ${entry.doi}` : 'External URL',
				href: doiHref,
				attr: { target: '_blank', rel: 'noopener noreferrer' },
			});
		}
		if (entry.codeUrl && /^https?:\/\//i.test(entry.codeUrl)) {
			metaRow.createEl('a', {
				text: 'Code Repo',
				href: entry.codeUrl,
				attr: { target: '_blank', rel: 'noopener noreferrer' },
			});
		}

		const actionsBar = headerCard.createDiv({ cls: 'zotero-library-actions' });
		const openBtn = actionsBar.createEl('button', {
			cls: 'mod-cta',
			text: 'Open Note (Enter)',
			attr: { type: 'button' },
		});
		openBtn.onclick = () => this.openSelectedLibraryNote();

		const baseName =
			entry.file.basename ||
			(entry.file.name || entry.file.path.split('/').pop() || '').replace(
				/\.md$/i,
				''
			);
		const copyWikiBtn = actionsBar.createEl('button', {
			text: 'Copy [[Wikilink]]',
			attr: { type: 'button' },
		});
		copyWikiBtn.onclick = async () => {
			const link = `[[${baseName}]]`;
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(link);
				new Notice(`Copied ${link}`);
			}
		};

		const copyKeyBtn = actionsBar.createEl('button', {
			text: 'Copy citekey',
			attr: { type: 'button' },
		});
		copyKeyBtn.onclick = async () => {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(entry.citekey);
				new Notice(`Copied ${entry.citekey}`);
			}
		};

		const connectBtn = actionsBar.createEl('button', {
			text: 'Connect Notes',
			attr: { type: 'button' },
		});
		connectBtn.onclick = () => {
			new ConnectorModal(this.app, this.plugin, entry.file, async () => {
				await this.reloadLibrary();
				this.renderLibraryResultsOnly();
			}).open();
		};

		// Core Note Section (Inline Edit & Save)
		const coreCard = detail.createDiv({ cls: 'zotero-digest-card zotero-library-core-card' });
		const coreHead = coreCard.createDiv({ cls: 'zotero-library-section-head' });
		coreHead.createSpan({ cls: 'zotero-digest-panel-title', text: 'Core Note' });
		if (!this.libraryEditingCore) {
			const editBtn = coreHead.createEl('button', {
				cls: 'zotero-library-inline-btn',
				text: entry.coreNoteBody ? 'Edit' : '+ Write Core Note',
				attr: { type: 'button' },
			});
			editBtn.onclick = () => {
				this.libraryEditingCore = true;
				this.renderLibraryResultsOnly();
			};
		}

		if (this.libraryEditingCore) {
			const editor = coreCard.createEl('textarea', {
				cls: 'zotero-core-note-editor',
				attr: {
					rows: '5',
					placeholder: 'Write core claim & personal takeaways...',
				},
			}) as HTMLTextAreaElement;
			editor.value = entry.coreNoteBody;

			const editActions = coreCard.createDiv({ cls: 'zotero-library-edit-actions' });
			const cancelBtn = editActions.createEl('button', {
				text: 'Cancel',
				attr: { type: 'button' },
			});
			cancelBtn.onclick = () => {
				this.libraryEditingCore = false;
				this.renderLibraryResultsOnly();
			};

			const saveBtn = editActions.createEl('button', {
				cls: 'mod-cta',
				text: 'Save Core Note',
				attr: { type: 'button' },
			});
			const commitSave = async () => {
				await this.getPaperHub().saveCoreNote(
					entry.citekey,
					{ body: editor.value.trim() },
					entry.file
				);
				this.libraryEditingCore = false;
				new Notice('Saved Core Note.');
				await this.reloadLibrary();
				this.renderLibraryResultsOnly();
			};
			saveBtn.onclick = () => void commitSave();
			editor.onkeydown = (ev) => {
				if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
					ev.preventDefault();
					void commitSave();
				} else if (ev.key === 'Escape') {
					ev.preventDefault();
					this.libraryEditingCore = false;
					this.renderLibraryResultsOnly();
				}
			};
			setTimeout(() => editor.focus(), 0);
		} else {
			const bodyBox = coreCard.createDiv({
				cls: entry.coreNoteBody
					? 'zotero-library-core-text'
					: 'zotero-core-note-placeholder',
				text:
					entry.coreNoteBody ||
					'Click "+ Write Core Note" to capture your core takeaway.',
			});
			bodyBox.onclick = () => {
				this.libraryEditingCore = true;
				this.renderLibraryResultsOnly();
			};
		}

		// Takeaway Research Profile
		if (entry.tldr || entry.novelty || entry.limitation) {
			const profileCard = detail.createDiv({
				cls: 'zotero-digest-card zotero-library-profile-card',
			});
			profileCard.createDiv({
				cls: 'zotero-digest-panel-title',
				text: 'Takeaway Research Profile',
			});
			const addProfileField = (label: string, val: string) => {
				if (!val) return;
				const row = profileCard.createDiv({ cls: 'zotero-library-profile-row' });
				row.createSpan({ cls: 'zotero-library-profile-key', text: label });
				row.createSpan({ cls: 'zotero-library-profile-val', text: val });
			};
			addProfileField('TL;DR', entry.tldr);
			addProfileField('Novelty', entry.novelty);
			addProfileField('Limitation', entry.limitation);
		}

		// Projects & Linked Chips
		if (entry.projects.length > 0 || entry.linkedNotes.length > 0) {
			const relCard = detail.createDiv({
				cls: 'zotero-digest-card zotero-library-links-card',
			});
			const renderChipRow = (title: string, links: string[], isProject: boolean) => {
				if (links.length === 0) return;
				const group = relCard.createDiv({ cls: 'zotero-links-group' });
				group.createSpan({ cls: 'zotero-links-label', text: title });
				const chips = group.createDiv({ cls: 'zotero-links-chips' });
				for (const raw of links) {
					const inner = raw.replace(/^\[\[|\]\]$/g, '').trim();
					const [target, alias] = inner.split('|');
					const label = (alias || target.split('/').pop() || target).trim();
					const chip = chips.createEl('a', {
						cls: `zotero-link-chip${isProject ? ' is-project' : ''}`,
						text: label,
						href: '#',
					});
					chip.onclick = (ev) => {
						ev.preventDefault();
						void this.app.workspace.openLinkText(target.trim(), entry.file.path);
					};
				}
			};
			renderChipRow('Projects', entry.projects, true);
			renderChipRow('Linked', entry.linkedNotes, false);
		}
	}

	// --- Digest Menu & Panels ------------------------------------------------

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
				text: record.manual_import
					? 'Accepted · manual'
					: STATUS_LABELS[record.status],
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
			panel.createDiv({
				text: record.manual_import
					? `Accepted, to import manually · ${day}`
					: `Accepted · ${day}`,
			});
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

		panel.createDiv({ cls: 'zotero-digest-panel-title', text: 'Collection' });
		const box = panel.createDiv({ cls: 'zotero-digest-collections' });
		const option = (key: string, name: string, depth: number) => {
			const label = box.createEl('label', { cls: 'zotero-digest-collection' });
			label.style.paddingLeft = `${depth * 16}px`;
			const input = label.createEl('input', {
				attr: { type: 'radio', name: 'zotero-digest-collection' },
			});
			input.checked = this.pickedCollection === key;
			input.onchange = () => {
				if (input.checked) this.pickedCollection = key;
			};
			label.createSpan({ text: name });
		};
		option('', 'Library root', 0);
		for (const collection of this.collections()) {
			option(collection.key, collection.name, collection.depth);
		}
		box.scrollTop = this.collectionScroll;
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
		if (this.offerManual) {
			const manual = buttons.createEl('button', {
				text: 'Accept, import manually',
			});
			manual.disabled = this.busy;
			manual.onclick = () => void this.acceptManually();
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

async function getOrCreateHubLeaf(plugin: ZoteroGKPlugin): Promise<WorkspaceLeaf> {
	const { workspace } = plugin.app;
	let leaf = workspace.getLeavesOfType(VIEW_TYPE_DIGEST)[0];
	if (!leaf) {
		leaf = workspace.openPopoutLeaf({ size: { width: 1180, height: 840 } });
		await leaf.setViewState({ type: VIEW_TYPE_DIGEST, active: true });
	}
	await workspace.revealLeaf(leaf);
	return leaf;
}

/** Opens the Paper Digest window (or reveals the open one) on Digest tab and runs an import. */
export async function openDigest(plugin: ZoteroGKPlugin): Promise<void> {
	const leaf = await getOrCreateHubLeaf(plugin);
	if (leaf.view instanceof PaperDigestView) {
		await leaf.view.switchHubTab('digest');
		await leaf.view.reload(true);
	}
}

/** Opens the Paper Hub directly on the searchable Vault Paper Library tab. */
export async function openPaperLibrary(
	plugin: ZoteroGKPlugin,
	venueFilter?: string
): Promise<void> {
	const leaf = await getOrCreateHubLeaf(plugin);
	if (leaf.view instanceof PaperDigestView) {
		await leaf.view.openLibrary(venueFilter);
	}
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
 * Registers the Paper Digest & Library view, commands and ribbon icon. Desktop only:
 * the window is a popout and talks to the local Zotero.
 */
export function registerDigest(plugin: ZoteroGKPlugin): void {
	if (!Platform.isDesktopApp) return;
	plugin.registerView(VIEW_TYPE_DIGEST, (leaf) => new PaperDigestView(leaf, plugin));
	plugin.addCommand({
		id: 'open-paper-digest',
		name: 'Open Paper Digest',
		callback: () => void openDigest(plugin),
	});
	plugin.addCommand({
		id: 'open-paper-library',
		name: 'Open Paper Library (Vault Search)',
		callback: () => void openPaperLibrary(plugin),
	});
	updateDigestRibbon(plugin);
}
