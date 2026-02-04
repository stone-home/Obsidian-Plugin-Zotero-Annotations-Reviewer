import { Plugin, Notice, TFile, SuggestModal, App, Modal, Setting, TextComponent, ButtonComponent } from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings, WebhookProfile } from './types';
import { ZoteroSettingTab } from './settings';
import { HighlightModal } from './ui/highlights';
import { AssistantView } from './ui/assistant';
import { WebhookService } from './services/webhook';
import { ZoteroService } from './services/zotero';
import { ObsidianService } from './services/obsidian';
import { DataviewService } from './services/dataview';
import { CFPService } from './services/cfp';
import { ProjectSelectorView } from './ui/project-selector';
import { CFPManualModal } from './ui/cfp-manual-modal';
import { CFPListModal } from './ui/cfp-list-modal';
import { CFPListView } from './ui/cfp-list-view';

export default class ZoteroGKPlugin extends Plugin {
	settings!: MyPluginSettings;
	zotero!: ZoteroService;
	obsidian!: ObsidianService;
	webhookService!: WebhookService;
	dataviewService!: DataviewService;
	cfpService!: CFPService;
	private webhookRibbonEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		this.zotero = new ZoteroService(this.settings.zoteroPort);
		this.obsidian = new ObsidianService(this.app, this.settings);
		this.webhookService = new WebhookService(this.app);
		this.dataviewService = new DataviewService(this.app);
		this.cfpService = new CFPService(
			this.app,
			() => this.settings,
			() => this.saveSettings()
		);

		// 1. Register Code Block
		this.registerMarkdownCodeBlockProcessor("zotero-assistant", (source, el, ctx) => {
			const view = new AssistantView(el, this);
			ctx.addChild(view);
			view.render(source, ctx);
		});

		this.registerMarkdownCodeBlockProcessor("project-picker", (source, el, ctx) => {
			const view = new ProjectSelectorView(el, this);
			ctx.addChild(view);
			view.render();
		});

		this.registerMarkdownCodeBlockProcessor("cfp-list", (source, el, ctx) => {
			const view = new CFPListView(el, this);
			ctx.addChild(view);
			view.render();
		});

		// 4. Webhook Command
		this.addCommand({
			id: 'zotero-trigger-webhook',
			name: 'Trigger Webhook...',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) {
					new WebhookSelectionModal(this.app, this.settings.webhooks, (hook, extraVariables) => {
						this.webhookService.triggerWebhook(hook, file, extraVariables);
					}).open();
				}
				return true;
			}
		});

		this.updateWebhookRibbonIcon();

		// CFP commands
		this.addCommand({
			id: 'cfp-refresh',
			name: 'Refresh CFP from websites',
			callback: () => this.cfpService.refresh()
		});
		this.addCommand({
			id: 'cfp-add-manual',
			name: 'Add manual CFP',
			callback: () => {
				new CFPManualModal(this.app, this.settings.cfpDefaultTags || [], (item) => {
					this.cfpService.saveManualCFP(item)
						.then(() => new Notice('CFP note created.'))
						.catch(() => new Notice('Failed to create CFP note.'));
				}).open();
			}
		});
		this.addCommand({
			id: 'cfp-show-list',
			name: 'Show CFP list (next & history)',
			callback: async () => {
				const data = await this.cfpService.getCFPNotesForDisplay();
				new CFPListModal(this.app, data).open();
			}
		});
		this.addCommand({
			id: 'cfp-refresh-wikicfp-series',
			name: 'Refresh CFP from WikiCFP Conf Series (A–Z)',
			callback: () => {
				new Notice('WikiCFP series refresh started (5–10s between pages). See console for progress.');
				this.cfpService.refreshWikiCFPSeries((msg) => {
					new Notice(msg);
				}).then(() => {
					new Notice('WikiCFP series refresh done.');
				}).catch((e) => {
					console.error('[CFP] WikiCFP series refresh failed', e);
					new Notice('WikiCFP series refresh failed. See console.');
				});
			}
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
				const baseName = file.basename.replace(/\s+Series$/, '');
				if (checking) return true;
				new Notice(`Refreshing events for ${baseName}...`);
				this.cfpService.refreshSeriesByUrl(seriesUrl, baseName, (msg) => new Notice(msg))
					.then(() => new Notice(`${baseName} events refreshed.`))
					.catch((e) => {
						console.error('[CFP] refresh this series failed', e);
						new Notice('Refresh failed. See console.');
					});
				return true;
			}
		});

		this.addSettingTab(new ZoteroSettingTab(this.app, this));

		// Auto-refresh CFP URL sources when due (background)
		if (this.cfpService.shouldRefresh()) {
			this.cfpService.refresh().catch(() => {});
		}
		// Auto-refresh WikiCFP Conference Series index when due (independent interval, e.g. monthly)
		if (this.cfpService.shouldSeriesRefresh()) {
			this.cfpService.refreshWikiCFPSeries().catch(() => {});
		}
		// Daily: refresh 10–20 series with ≥30 min gap (anti-crawl)
		this.cfpService.runDailySeriesRefresh().catch(() => {});

		// Expose CFP refresh on window so DataviewJS can call plugin parse/fetch directly
		const win = window as unknown as { __ZoteroAnnotationReviewerCFP?: import('./types').CFPWindowAPI };
		win.__ZoteroAnnotationReviewerCFP = {
			refreshSeries: (programUrl: string, seriesAcronym: string) => {
				new Notice(`Refreshing events for ${seriesAcronym}...`);
				return this.cfpService.refreshSeriesByUrl(programUrl, seriesAcronym, (msg) => new Notice(msg))
					.then(() => { new Notice(`${seriesAcronym} events refreshed.`); })
					.catch((e) => {
						console.error('[CFP] refresh series failed', e);
						new Notice('Refresh failed. See console.');
					}) as Promise<void>;
			}
		};
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
			this.webhookRibbonEl = this.addRibbonIcon('webhook', 'Trigger Webhook...', () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice('Open a note first.');
					return;
				}
				new WebhookSelectionModal(this.app, this.settings.webhooks, (hook, extraVariables) => {
					this.webhookService.triggerWebhook(hook, file, extraVariables);
				}).open();
			});
		}
	}

	async triggerReviewForActiveFile(file: TFile) {
		const cache = this.app.metadataCache.getFileCache(file);
		const key = cache?.frontmatter?.[this.settings.citationKeyName] ||
			cache?.frontmatter?.['zotero-key'] ||
			cache?.frontmatter?.['citation-key'];

		if (key) {
			new HighlightModal(this.app, this.settings, key, {}).open();
		} else {
			new Notice("❌ No citation key found.");
		}
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		// Ensure CFP defaults for existing users who never had CFP keys
		if (!Array.isArray(this.settings.cfpDefaultTags)) this.settings.cfpDefaultTags = DEFAULT_SETTINGS.cfpDefaultTags;
		if (!Array.isArray(this.settings.cfpWikicfpUrls)) this.settings.cfpWikicfpUrls = DEFAULT_SETTINGS.cfpWikicfpUrls;
		if (!Array.isArray(this.settings.cfpEasychairUrls)) this.settings.cfpEasychairUrls = DEFAULT_SETTINGS.cfpEasychairUrls;
		if (!Array.isArray(this.settings.cfpCcfddlUrls)) this.settings.cfpCcfddlUrls = DEFAULT_SETTINGS.cfpCcfddlUrls;
		if (!Array.isArray(this.settings.cfpOpenresearchUrls)) this.settings.cfpOpenresearchUrls = DEFAULT_SETTINGS.cfpOpenresearchUrls;
		if (typeof this.settings.cfpRefreshDays !== 'number') this.settings.cfpRefreshDays = DEFAULT_SETTINGS.cfpRefreshDays;
		if (typeof this.settings.cfpLastFetchTime !== 'number') this.settings.cfpLastFetchTime = DEFAULT_SETTINGS.cfpLastFetchTime;
		if (typeof this.settings.cfpSeriesRefreshDays !== 'number') this.settings.cfpSeriesRefreshDays = DEFAULT_SETTINGS.cfpSeriesRefreshDays;
		if (typeof this.settings.cfpLastSeriesFetchTime !== 'number') this.settings.cfpLastSeriesFetchTime = DEFAULT_SETTINGS.cfpLastSeriesFetchTime;
		if (typeof this.settings.cfpNoteDir !== 'string') this.settings.cfpNoteDir = DEFAULT_SETTINGS.cfpNoteDir;
		if (typeof this.settings.cfpSeriesMap !== 'object' || this.settings.cfpSeriesMap === null) this.settings.cfpSeriesMap = DEFAULT_SETTINGS.cfpSeriesMap;
		if (typeof this.settings.cfpLastDailyRun !== 'number') this.settings.cfpLastDailyRun = DEFAULT_SETTINGS.cfpLastDailyRun;
		if (!Array.isArray(this.settings.cfpSeriesIndexLetters)) this.settings.cfpSeriesIndexLetters = DEFAULT_SETTINGS.cfpSeriesIndexLetters;
		if (typeof this.settings.cfpSeriesDataviewJSCode !== 'string') this.settings.cfpSeriesDataviewJSCode = DEFAULT_SETTINGS.cfpSeriesDataviewJSCode;
		if (typeof this.settings.cfpAcronymKey !== 'string') this.settings.cfpAcronymKey = DEFAULT_SETTINGS.cfpAcronymKey;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class WebhookSelectionModal extends SuggestModal<WebhookProfile> {
	webhooks: WebhookProfile[];
	onChoose: (hook: WebhookProfile, extraVariables?: Record<string, string>) => void;

	constructor(app: App, webhooks: WebhookProfile[], onChoose: (hook: WebhookProfile, extraVariables?: Record<string, string>) => void) {
		super(app);
		this.webhooks = webhooks;
		this.onChoose = onChoose;
	}

	getSuggestions(query: string): WebhookProfile[] {
		return this.webhooks.filter(hook => hook.name.toLowerCase().includes(query.toLowerCase()));
	}

	renderSuggestion(hook: WebhookProfile, el: HTMLElement) {
		el.createDiv({ text: hook.name });
		el.createDiv({ text: hook.url, cls: "zotero-text-muted-italic" });
	}

	onChooseSuggestion(hook: WebhookProfile, evt: MouseEvent | KeyboardEvent) {
		this.close();
		const vars = (hook.inputVariables ?? []).filter(iv => iv.name?.trim());
		if (vars.length > 0) {
			new WebhookInputValueModal(this.app, hook.name, vars, (values) => {
				this.onChoose(hook, values);
			}).open();
		} else {
			this.onChoose(hook);
		}
	}
}

/** Asks for input values when the webhook has inputVariables configured. */
class WebhookInputValueModal extends Modal {
	title: string;
	variables: { name: string; type: 'text' | 'number' }[];
	onSubmit: (values: Record<string, string>) => void;
	private inputs: Map<string, TextComponent> = new Map();

	constructor(app: App, title: string, variables: { name: string; type: 'text' | 'number' }[], onSubmit: (values: Record<string, string>) => void) {
		super(app);
		this.title = title;
		this.variables = variables;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("zotero-webhook-input-modal");
		contentEl.createEl("h2", { text: this.title, cls: "zotero-webhook-input-title" });
		const desc = contentEl.createDiv({ cls: "zotero-webhook-input-desc" });
		desc.setText("Enter values to substitute in the webhook body.");
		const form = contentEl.createDiv({ cls: "zotero-webhook-input-form" });
		this.variables.forEach(iv => {
			const row = form.createDiv({ cls: "zotero-webhook-input-row" });
			row.createEl("label", { text: `{{${iv.name}}}`, cls: "zotero-webhook-input-label" });
			const tc = new TextComponent(row);
			tc.inputEl.addClass("zotero-webhook-input-field");
			if (iv.type === 'number') {
				tc.inputEl.type = 'number';
				tc.setPlaceholder('0');
			} else {
				tc.setPlaceholder('Optional');
			}
			this.inputs.set(iv.name, tc);
		});
		const footer = contentEl.createDiv({ cls: "zotero-webhook-input-footer" });
		new ButtonComponent(footer).setButtonText("Cancel").onClick(() => this.close());
		new ButtonComponent(footer).setButtonText("Trigger").setCta().onClick(() => {
			const values: Record<string, string> = {};
			this.variables.forEach(iv => {
				const v = this.inputs.get(iv.name)?.getValue() ?? '';
				values[iv.name] = iv.type === 'number' ? String(Number(v) ?? v) : v;
			});
			this.close();
			this.onSubmit(values);
		}).buttonEl.addClass("zotero-btn-fancy");
	}
}
