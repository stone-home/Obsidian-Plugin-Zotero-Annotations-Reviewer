import { Plugin, Notice, TFile, SuggestModal, App, Modal, Setting, TextComponent, ButtonComponent } from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings, WebhookProfile } from './types';
import { ZoteroSettingTab } from './settings';
import { HighlightModal } from './ui/highlights';
import { AssistantView } from './ui/assistant';
import { WebhookService } from './services/webhook';
import { ZoteroService } from './services/zotero';
import { ObsidianService } from './services/obsidian';
import { DataviewService } from './services/dataview';
import { ProjectSelectorView} from "./ui/project-selector";

export default class ZoteroGKPlugin extends Plugin {
	settings!: MyPluginSettings;
	zotero!: ZoteroService;
	obsidian!: ObsidianService;
	webhookService!: WebhookService;
	dataviewService!: DataviewService;
	private webhookRibbonEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		this.zotero = new ZoteroService(this.settings.zoteroPort);
		this.obsidian = new ObsidianService(this.app, this.settings);
		this.webhookService = new WebhookService(this.app);
		this.dataviewService = new DataviewService(this.app);

		// 1. Register Code Block
		this.registerMarkdownCodeBlockProcessor("zotero-assistant", (source, el, ctx) => {
			const view = new AssistantView(el, this);
			ctx.addChild(view);
			view.render(source, ctx);
		});

		this.registerMarkdownCodeBlockProcessor("project-picker", (source, el, ctx) => {
			const view = new ProjectSelectorView(el, this);
			ctx.addChild(view);
			// We call view.onload() or view.render() immediately
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

		this.addSettingTab(new ZoteroSettingTab(this.app, this));
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
