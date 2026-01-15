import { Plugin, Notice, TFile, SuggestModal, App } from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings, WebhookProfile } from './types';
import { ZoteroSettingTab } from './settings';
import { HighlightModal } from './ui/highlights';
import { InputModal } from './ui/inputs';
import { AssistantView } from './ui/assistant';
import { WebhookService } from './services/webhook';
import { ZoteroService } from './services/zotero';
import { ObsidianService } from './services/obsidian';

export default class ZoteroGKPlugin extends Plugin {
	settings!: MyPluginSettings;
	zotero!: ZoteroService;
	obsidian!: ObsidianService;
	webhookService!: WebhookService;

	async onload() {
		await this.loadSettings();

		this.zotero = new ZoteroService(this.settings.zoteroPort);
		this.obsidian = new ObsidianService(this.app, this.settings);
		this.webhookService = new WebhookService(this.app);

		// 1. Register Code Block
		this.registerMarkdownCodeBlockProcessor("zotero-assistant", (source, el, ctx) => {
			const view = new AssistantView(el, this);
			ctx.addChild(view);
			view.render(source, ctx);
		});

		// 2. Create Note Command
		this.addCommand({
			id: 'zotero-create-dashboard',
			name: 'Create Literature Note (Enter Citation Key)',
			callback: () => {
				new InputModal(this.app, async (key) => {
					if (!key) return;
					try {
						const meta = await this.zotero.getItemMetadata(key);
						if(meta) {
							const file = await this.obsidian.createLiteratureNote(meta);
							await this.app.workspace.getLeaf(true).openFile(file);
						}
					} catch(e) {
						new Notice("Error: " + (e as Error).message);
					}
				}).open();
			}
		});

		// 3. Review Command
		this.addCommand({
			id: 'zotero-review-current',
			name: 'Review Highlights (Current Note)',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) this.triggerReviewForActiveFile(file);
				return true;
			}
		});

		// 4. NEW: Trigger Webhook Command
		this.addCommand({
			id: 'zotero-trigger-webhook',
			name: 'Trigger Webhook...',
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file) return false;
				if (!checking) {
					// Open selection modal
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

// Simple Helper Modal for selecting a webhook from command palette
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
