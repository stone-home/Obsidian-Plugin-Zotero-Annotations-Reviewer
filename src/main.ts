import { Notice, Plugin, TFile } from 'obsidian';
import {
	DEFAULT_PAPER_WORKSPACE,
	DEFAULT_PROMPTS,
	DEFAULT_SETTINGS,
	DEFAULT_ZOTERO_TEMPLATE,
	MyPluginSettings,
	PromptTemplateEntry,
} from './types';
import { ZoteroSettingTab } from './settings';
import { HighlightModal } from './ui/highlights';
import { AssistantView } from './ui/assistant';
import { WebhookSelectionModal } from './ui/webhook-modals';
import { WebhookService } from './services/webhook';
import { ZoteroService } from './services/zotero';
import { ObsidianService } from './services/obsidian';
import { DataviewService } from './services/dataview';
import { CFPService } from './services/cfp';
import { PaperHubService } from './services/paper-hub';
import { VaultLibraryService } from './services/vault-library';
import { ProjectSelectorView } from './ui/project-selector';
import { CFPManualModal } from './ui/cfp-manual-modal';
import { CFPListModal } from './ui/cfp-list-modal';
import { CFPListView } from './ui/cfp-list-view';
import { normalizePath } from './utils/paths';

export default class ZoteroGKPlugin extends Plugin {
	settings!: MyPluginSettings;
	zotero!: ZoteroService;
	obsidian!: ObsidianService;
	webhookService!: WebhookService;
	dataviewService!: DataviewService;
	cfpService!: CFPService;
	paperHub!: PaperHubService;
	vaultLibrary!: VaultLibraryService;
	private webhookRibbonEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		this.zotero = new ZoteroService(this.settings.zoteroPort);
		this.obsidian = new ObsidianService(this.app, this.settings);
		this.paperHub = new PaperHubService(this.app, () => this.settings);
		this.vaultLibrary = new VaultLibraryService(
			this.app,
			() => this.settings,
			this.paperHub
		);
		this.webhookService = new WebhookService(this.app, () => this.settings);
		this.dataviewService = new DataviewService(this.app);
		this.cfpService = new CFPService(
			this.app,
			() => this.settings,
			() => this.saveSettings()
		);

		// 1. Register Code Blocks
		this.registerMarkdownCodeBlockProcessor(
			'zotero-assistant',
			(source, el, ctx) => {
				const view = new AssistantView(el, this);
				ctx.addChild(view);
				void view.render(source, ctx);
			}
		);

		this.registerMarkdownCodeBlockProcessor('project-picker', (source, el, ctx) => {
			const view = new ProjectSelectorView(el, this);
			ctx.addChild(view);
			view.render();
		});

		this.registerMarkdownCodeBlockProcessor('cfp-list', (source, el, ctx) => {
			const view = new CFPListView(el, this);
			ctx.addChild(view);
			void view.render();
		});

		// 2. Webhook Command
		this.addCommand({
			id: 'zotero-trigger-webhook',
			name: 'Trigger Webhook...',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) {
					new WebhookSelectionModal(
						this.app,
						this.settings.webhooks,
						(hook, extraVariables) => {
							void this.webhookService.triggerWebhook(
								hook,
								file,
								extraVariables,
								this.settings.webhookDebugMode
							);
						}
					).open();
				}
				return true;
			},
		});

		this.updateWebhookRibbonIcon();

		// 3. CFP commands
		this.addCommand({
			id: 'cfp-refresh',
			name: 'Refresh CFP from websites',
			callback: () => this.cfpService.refresh(),
		});
		this.addCommand({
			id: 'cfp-add-manual',
			name: 'Add manual CFP',
			callback: () => {
				new CFPManualModal(
					this.app,
					this.settings.cfpDefaultTags || [],
					(item) => {
						this.cfpService
							.saveManualCFP(item)
							.then(() => new Notice('CFP note created.'))
							.catch(() => new Notice('Failed to create CFP note.'));
					}
				).open();
			},
		});
		this.addCommand({
			id: 'cfp-show-list',
			name: 'Show CFP list (next & history)',
			callback: async () => {
				const data = await this.cfpService.getCFPNotesForDisplay();
				new CFPListModal(this.app, data).open();
			},
		});
		this.addCommand({
			id: 'cfp-refresh-wikicfp-series',
			name: 'Refresh CFP from WikiCFP Conf Series (A–Z)',
			callback: () => {
				new Notice(
					'WikiCFP series refresh started (5–10s between pages). See console for progress.'
				);
				this.cfpService
					.refreshWikiCFPSeries((msg) => {
						new Notice(msg);
					})
					.then(() => {
						new Notice('WikiCFP series refresh done.');
					})
					.catch((e) => {
						console.error('[CFP] WikiCFP series refresh failed', e);
						new Notice('WikiCFP series refresh failed. See console.');
					});
			},
		});
		this.addCommand({
			id: 'cfp-refresh-this-series',
			name: 'Refresh CFP for this series',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				const cache = this.app.metadataCache.getFileCache(file);
				const isSeries = cache?.frontmatter?.['cfp-series'];
				const seriesUrl = cache?.frontmatter?.['series-url']?.toString?.();
				if (!isSeries || !seriesUrl) return false;
				const baseName = file.basename
					.replace(/\s+/g, ' ')
					.replace(/ Series$/, '');
				if (checking) return true;
				new Notice(`Refreshing events for ${baseName}...`);
				this.cfpService
					.refreshSeriesByUrl(seriesUrl, baseName, (msg) => new Notice(msg))
					.then(() => new Notice(`${baseName} events refreshed.`))
					.catch((e) => {
						console.error('[CFP] refresh this series failed', e);
						new Notice('Refresh failed. See console.');
					});
				return true;
			},
		});

		this.addSettingTab(new ZoteroSettingTab(this.app, this));

		// Auto-refresh CFP URL sources when due (background)
		if (this.cfpService.shouldRefresh()) {
			this.cfpService
				.refresh()
				.catch((err) => console.warn('[CFP] background refresh failed:', err));
		}
		// Auto-refresh WikiCFP Conference Series index when due
		if (this.cfpService.shouldSeriesRefresh()) {
			this.cfpService
				.refreshWikiCFPSeries()
				.catch((err) => console.warn('[CFP] background refresh failed:', err));
		}
		// Daily: refresh 10–20 series with >=30 min gap (anti-crawl)
		this.cfpService
			.runDailySeriesRefresh()
			.catch((err) => console.warn('[CFP] background refresh failed:', err));

		// Expose CFP refresh on window so DataviewJS can call plugin parse/fetch directly
		const win = window as unknown as {
			__ZoteroAnnotationReviewerCFP?: import('./types').CFPWindowAPI;
		};
		win.__ZoteroAnnotationReviewerCFP = {
			refreshSeries: (programUrl: string, seriesAcronym: string) => {
				new Notice(`Refreshing events for ${seriesAcronym}...`);
				return this.cfpService
					.refreshSeriesByUrl(
						programUrl,
						seriesAcronym,
						(msg) => new Notice(msg)
					)
					.then(() => {
						new Notice(`${seriesAcronym} events refreshed.`);
					})
					.catch((e) => {
						console.error('[CFP] refresh series failed', e);
						new Notice('Refresh failed. See console.');
					}) as Promise<void>;
			},
		};

		// Materialize missing built-in note templates and prompts once Vault layout is ready
		this.app.workspace.onLayoutReady?.(() => {
			void this.paperHub
				.ensureBuiltinTemplatesInVault()
				.catch((e) => console.error('[Paper Hub] template init failed', e));
		});

		// Paper House (Digest & Library) is loaded lazily so that a failure there cannot stop the plugin loading.
		import('./ui/digest-view')
			.then((digest) => digest.registerDigest(this))
			.catch((e) => console.error('[Paper Digest] registration failed', e));
	}

	onunload() {
		const win = window as unknown as { __ZoteroAnnotationReviewerCFP?: unknown };
		delete win.__ZoteroAnnotationReviewerCFP;
	}

	/** Add or remove the webhook ribbon icon based on settings. Call after changing webhookShowInRibbon. */
	updateWebhookRibbonIcon(): void {
		if (this.webhookRibbonEl) {
			this.webhookRibbonEl.remove();
			this.webhookRibbonEl = null;
		}
		if (this.settings.webhookShowInRibbon) {
			this.webhookRibbonEl = this.addRibbonIcon(
				'webhook',
				'Trigger Webhook...',
				() => {
					const file = this.app.workspace.getActiveFile();
					if (!file) {
						new Notice('Open a note first.');
						return;
					}
					new WebhookSelectionModal(
						this.app,
						this.settings.webhooks,
						(hook, extraVariables) => {
							void this.webhookService.triggerWebhook(
								hook,
								file,
								extraVariables,
								this.settings.webhookDebugMode
							);
						}
					).open();
				}
			);
		}
	}

	async triggerReviewForActiveFile(file: TFile) {
		const cache = this.app.metadataCache.getFileCache(file);
		const key =
			cache?.frontmatter?.[this.settings.citationKeyName] ||
			cache?.frontmatter?.['zotero-key'] ||
			cache?.frontmatter?.['citation-key'];

		if (key) {
			new HighlightModal(this.app, this.settings, key, {}).open();
		} else {
			new Notice('❌ No citation key found.');
		}
	}

	async loadSettings() {
		const data = (await this.loadData()) as Partial<MyPluginSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

		// Merge Paper Workspace config safely
		this.settings.paperWorkspace = Object.assign(
			{},
			DEFAULT_PAPER_WORKSPACE,
			data?.paperWorkspace
		);
		if (
			data &&
			typeof data.fleetingNoteFolder === 'string' &&
			!data.paperWorkspace?.highlightNotesFolder
		) {
			this.settings.paperWorkspace.highlightNotesFolder = data.fleetingNoteFolder;
		}
		if (!this.settings.paperWorkspace.templatesFolder?.trim()) {
			this.settings.paperWorkspace.templatesFolder =
				DEFAULT_PAPER_WORKSPACE.templatesFolder;
		}
		if (!this.settings.paperWorkspace.report1Label?.trim()) {
			this.settings.paperWorkspace.report1Label =
				DEFAULT_PAPER_WORKSPACE.report1Label;
		}
		if (!this.settings.paperWorkspace.report2Label?.trim()) {
			this.settings.paperWorkspace.report2Label =
				DEFAULT_PAPER_WORKSPACE.report2Label;
		}
		if (!this.settings.paperWorkspace.takeawayLabel?.trim()) {
			this.settings.paperWorkspace.takeawayLabel =
				DEFAULT_PAPER_WORKSPACE.takeawayLabel;
		}
		delete (this.settings.paperWorkspace as unknown as Record<string, unknown>)[
			's3Prefix'
		];

		const tplFolder = normalizePath(
			this.settings.paperWorkspace.templatesFolder
		).replace(/\/+$/, '');
		const defaultZotPath = tplFolder
			? `${tplFolder}/zotero-note-template.md`
			: 'zotero-note-template.md';

		// Merge Zotero Template config safely
		this.settings.zoteroTemplate = Object.assign(
			{ vaultPath: defaultZotPath, content: DEFAULT_ZOTERO_TEMPLATE },
			data?.zoteroTemplate
		);
		if (!this.settings.zoteroTemplate.vaultPath?.trim()) {
			this.settings.zoteroTemplate.vaultPath = defaultZotPath;
		}
		if (
			typeof this.settings.zoteroTemplate.content !== 'string' ||
			!this.settings.zoteroTemplate.content
		) {
			this.settings.zoteroTemplate.content = DEFAULT_ZOTERO_TEMPLATE;
		}

		// Merge Templates & Prompts safely while preserving built-ins and user customizations on upgrade
		if (!Array.isArray(data?.prompts)) {
			this.settings.prompts = DEFAULT_PROMPTS.map((p) => {
				const relFile = p.vaultPath.replace(/^900-Templates\//, '');
				return {
					...p,
					vaultPath: tplFolder ? `${tplFolder}/${relFile}` : relFile,
				};
			});
		} else {
			const existingById = new Map<string, PromptTemplateEntry>();
			for (const p of data.prompts) {
				existingById.set(p.id, { ...p });
			}
			const mergedPrompts: PromptTemplateEntry[] = [];
			for (const bp of DEFAULT_PROMPTS) {
				const existing = existingById.get(bp.id);
				if (existing) {
					if (!existing.kind) existing.kind = bp.kind ?? 'prompt';
					if (existing.builtIn === undefined) existing.builtIn = true;
					mergedPrompts.push(existing);
					existingById.delete(bp.id);
				} else {
					const relFile = bp.vaultPath.replace(/^900-Templates\//, '');
					mergedPrompts.push({
						...bp,
						vaultPath: tplFolder ? `${tplFolder}/${relFile}` : relFile,
					});
				}
			}
			for (const custom of existingById.values()) {
				if (!custom.kind) custom.kind = 'prompt';
				mergedPrompts.push(custom);
			}
			this.settings.prompts = mergedPrompts;
		}

		if (typeof this.settings.enableLegacyAssistantScript !== 'boolean') {
			this.settings.enableLegacyAssistantScript = false;
		}

		// Ensure CFP defaults for existing users who never had CFP keys
		if (!Array.isArray(this.settings.cfpDefaultTags))
			this.settings.cfpDefaultTags = DEFAULT_SETTINGS.cfpDefaultTags;
		if (!Array.isArray(this.settings.cfpWikicfpUrls))
			this.settings.cfpWikicfpUrls = DEFAULT_SETTINGS.cfpWikicfpUrls;
		if (!Array.isArray(this.settings.cfpEasychairUrls))
			this.settings.cfpEasychairUrls = DEFAULT_SETTINGS.cfpEasychairUrls;
		if (!Array.isArray(this.settings.cfpCcfddlUrls))
			this.settings.cfpCcfddlUrls = DEFAULT_SETTINGS.cfpCcfddlUrls;
		if (!Array.isArray(this.settings.cfpOpenresearchUrls))
			this.settings.cfpOpenresearchUrls = DEFAULT_SETTINGS.cfpOpenresearchUrls;
		if (typeof this.settings.cfpRefreshDays !== 'number')
			this.settings.cfpRefreshDays = DEFAULT_SETTINGS.cfpRefreshDays;
		if (typeof this.settings.cfpLastFetchTime !== 'number')
			this.settings.cfpLastFetchTime = DEFAULT_SETTINGS.cfpLastFetchTime;
		if (typeof this.settings.cfpSeriesRefreshDays !== 'number')
			this.settings.cfpSeriesRefreshDays = DEFAULT_SETTINGS.cfpSeriesRefreshDays;
		if (typeof this.settings.cfpLastSeriesFetchTime !== 'number')
			this.settings.cfpLastSeriesFetchTime =
				DEFAULT_SETTINGS.cfpLastSeriesFetchTime;
		if (typeof this.settings.cfpNoteDir !== 'string')
			this.settings.cfpNoteDir = DEFAULT_SETTINGS.cfpNoteDir;
		if (
			typeof this.settings.cfpSeriesMap !== 'object' ||
			this.settings.cfpSeriesMap === null
		)
			this.settings.cfpSeriesMap = DEFAULT_SETTINGS.cfpSeriesMap;
		if (typeof this.settings.cfpLastDailyRun !== 'number')
			this.settings.cfpLastDailyRun = DEFAULT_SETTINGS.cfpLastDailyRun;
		if (!Array.isArray(this.settings.cfpSeriesIndexLetters))
			this.settings.cfpSeriesIndexLetters =
				DEFAULT_SETTINGS.cfpSeriesIndexLetters;
		if (typeof this.settings.cfpSeriesDataviewJSCode !== 'string')
			this.settings.cfpSeriesDataviewJSCode =
				DEFAULT_SETTINGS.cfpSeriesDataviewJSCode;
		if (typeof this.settings.cfpAcronymKey !== 'string')
			this.settings.cfpAcronymKey = DEFAULT_SETTINGS.cfpAcronymKey;
		if (typeof this.settings.cfpCoreCsvPath !== 'string')
			this.settings.cfpCoreCsvPath = DEFAULT_SETTINGS.cfpCoreCsvPath;
		if (typeof this.settings.cfpCcfddlLocalPath !== 'string')
			this.settings.cfpCcfddlLocalPath = DEFAULT_SETTINGS.cfpCcfddlLocalPath;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
