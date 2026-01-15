import { MarkdownPostProcessorContext, MarkdownRenderChild, TFile, ButtonComponent, Notice } from 'obsidian';
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

		let imageMap = parseImageMap(source);
		const container = el.createDiv({ cls: 'zotero-assistant-container' });

		const header = container.createDiv({ cls: 'zotero-assistant-header' });
		header.createEl("h4", { text: "🤖 Zotero Assistant", cls: "zotero-title" });

		// --- Actions Row ---
		const btnRow = container.createDiv({ cls: 'zotero-assistant-actions' });

		// 1. Highlight Review Button
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const key = cache?.frontmatter?.['zotero-key'] || cache?.frontmatter?.['citation-key'];

		new ButtonComponent(btnRow)
			.setButtonText(`Fetch / Review Highlights`)
			.setCta()
			.setDisabled(!key)
			.onClick(() => {
				if (key) new HighlightModal(this.plugin.app, this.plugin.settings, key, imageMap).open();
			});

		// 2. Webhook Button (Conditional)
		const webhookBtn = new ButtonComponent(btnRow)
			.setButtonText("Send Webhook")
			.setIcon("plane");

		// Check Conditions asynchronously
		const isWebhookActive = await this.plugin.webhookService.checkConditions(file);

		if (isWebhookActive) {
			webhookBtn.onClick(async () => {
				await this.plugin.webhookService.sendNoteData(file);
			});
		} else {
			webhookBtn.setDisabled(true);
			webhookBtn.setTooltip("Conditions not met (check settings)");
		}

		// --- Local Highlights ---
		container.createEl("hr");
		container.createEl("h5", { text: "📝 Related Notes / Highlights" });
		const highlightsDiv = container.createDiv({ cls: 'zotero-local-highlights' });

		await this.renderLocalHighlights(file, highlightsDiv);
	}

	async renderLocalHighlights(file: TFile, container: HTMLElement) {
		const customScript = this.plugin.settings.assistantScript;

		if (customScript && customScript.trim().length > 0) {
			try {
				const func = new Function('container', 'file', 'app', customScript);
				await func(container, file, this.plugin.app);
			} catch (e) {
				container.createDiv({
					text: `⚠️ Custom Script Error: ${(e as Error).message}`,
					cls: "zotero-text-error"
				});
				console.error("Assistant Script Error:", e);
			}
			return;
		}

		// Default Logic
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
