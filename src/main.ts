import { Plugin, Notice, TFile, SuggestModal, App } from 'obsidian';
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
					new WebhookSelectionModal(this.app, this.settings.webhooks, (hook) => {
						this.webhookService.triggerWebhook(hook, file);
					}).open();
				}
				return true;
			}
		});

		this.addSettingTab(new ZoteroSettingTab(this.app, this));
	}

	async triggerReviewForActiveFile(file: TFile) {
		const cache = this.app.metadataCache.getFileCache(file);
		const key = cache?.frontmatter?.['zotero-key'] || cache?.frontmatter?.['citation-key'];

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
	onChoose: (hook: WebhookProfile) => void;

	constructor(app: App, webhooks: WebhookProfile[], onChoose: (hook: WebhookProfile) => void) {
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
		this.onChoose(hook);
	}
}
