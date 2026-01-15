import { MarkdownPostProcessorContext, MarkdownRenderChild, TFile, ButtonComponent } from 'obsidian';
import ZoteroGKPlugin from '../main';
import { HighlightModal } from './highlights';
import { parseImageMap } from '../utils/parser';

export class AssistantView extends MarkdownRenderChild {
	plugin: ZoteroGKPlugin;

	constructor(containerEl: HTMLElement, plugin: ZoteroGKPlugin) {
		super(containerEl);
		this.plugin = plugin;
	}

	async render(source: string, ctx: MarkdownPostProcessorContext) {
		const el = this.containerEl;
		const file = this.plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);

		if (!(file instanceof TFile)) {
			el.createDiv({ text: "Assistant only works in notes." });
			return;
		}

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter;
		const key = frontmatter?.['zotero-key'] || frontmatter?.['citation-key'];

		// --- 1. ROBUST JSON PARSING (Refactored) ---
		let imageMap: Record<string, string> = {};
		try {
			imageMap = parseImageMap(source);
		} catch (e) {
			el.createDiv({
				text: `⚠️ JSON Map Error: ${(e as Error).message}. Check console.`,
				cls: "zotero-error-msg"
			});
		}

		const container = el.createDiv({ cls: 'zotero-assistant-container' });

		// --- Header ---
		const header = container.createDiv({ cls: 'zotero-assistant-header' });
		header.createEl("h4", { text: "🤖 Zotero Assistant", cls: "zotero-title" });

		if (key) {
			header.createEl("code", { text: key, cls: "zotero-key" });
		} else {
			header.createEl("span", { text: " (No Key Found)", cls: "zotero-text-error" });
		}

		// --- Buttons ---
		const btnRow = container.createDiv({ cls: 'zotero-assistant-actions' });

		// Button 1: Fetch/Review
		new ButtonComponent(btnRow)
			.setButtonText(`Fetch / Review Highlights`)
			.setCta()
			.setDisabled(!key)
			.onClick(() => {
				if (key) {
					new HighlightModal(this.plugin.app, this.plugin.settings, key, imageMap).open();
				}
			});

		// Button 2: Webhook
		const btnWebhook = new ButtonComponent(btnRow).setButtonText("Send Webhook");

		// Condition Logic
		const condition = this.plugin.settings.webhookCondition;
		let isWebhookEnabled = true;
		let disableReason = "";

		if (condition && condition.trim().length > 0) {
			try {
				const fmString = JSON.stringify(frontmatter || {});
				const regex = new RegExp(condition, 'i');
				if (!regex.test(fmString)) {
					isWebhookEnabled = false;
					disableReason = `Condition not met: "${condition}"`;
				}
			} catch (e) {
				console.error("Invalid Regex", e);
				isWebhookEnabled = false;
			}
		}

		if (isWebhookEnabled) {
			btnWebhook.onClick(() => this.plugin.webhookService.sendNoteData(file));
		} else {
			btnWebhook.setDisabled(true);
			btnWebhook.setTooltip(disableReason);
			btnWebhook.buttonEl.addClass("is-disabled-opacity");
		}

		// --- Local Highlights ---
		container.createEl("hr");
		container.createEl("h5", { text: "📝 Local Highlights Preview" });
		const highlightsDiv = container.createDiv({ cls: 'zotero-local-highlights' });
		await this.renderLocalHighlights(file, highlightsDiv);
	}

	async renderLocalHighlights(file: TFile, container: HTMLElement) {
		const content = await this.plugin.app.vault.read(file);
		const lines = content.split('\n');
		let found = 0;
		const list = container.createEl("ul", { cls: "zotero-highlight-list" });

		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith('>') && !trimmed.includes('[!')) {
				const text = trimmed.replace(/^>\s*/, '').trim();
				if (text.length > 0) {
					const li = list.createEl("li", { cls: "zotero-highlight-item" });
					li.innerText = text.length > 100 ? text.slice(0, 100) + "..." : text;
					found++;
				}
			} else if (trimmed.includes('==')) {
				const matches = trimmed.match(/==(.*?)==/g);
				if (matches) matches.forEach(m => {
					const li = list.createEl("li", { cls: "zotero-highlight-item" });
					li.innerText = m.replace(/==/g, '');
					found++;
				});
			}
		}
		if (found === 0) container.createDiv({ text: "No highlights detected.", cls: "zotero-text-muted-italic" });
	}
}
