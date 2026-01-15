import { MarkdownPostProcessorContext, MarkdownRenderChild, TFile, ButtonComponent, Notice } from 'obsidian';
import ZoteroGKPlugin from '../main';
import { HighlightModal } from './highlights';

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

		// --- 1. ROBUST JSON PARSING ---
		let imageMap: Record<string, string> = {};
		const rawSource = source.trim();

		if (rawSource.length > 0) {
			try {
				// Attempt 1: Standard Parse
				imageMap = JSON.parse(rawSource);
				console.log("[Zotero Assistant] JSON Parsed Successfully:", imageMap);
			} catch (e) {
				console.warn("[Zotero Assistant] Standard JSON parse failed. Trying to sanitize Windows paths...", e);

				try {
					// Attempt 2: Sanitize Windows Paths
					// Replace single backslashes \ that are NOT followed by valid JSON escape chars (", \, /, b, f, n, r, t, u)
					// This fixes "Attachments\Image.png" -> "Attachments\\Image.png"
					const sanitized = rawSource.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
					imageMap = JSON.parse(sanitized);
					console.log("[Zotero Assistant] Sanitized JSON Parsed:", imageMap);
				} catch (e2) {
					console.error("[Zotero Assistant] Fatal JSON Error:", e2);
					console.log("[Zotero Assistant] problematic source:", rawSource);

					// Show Error in UI so you know why it's empty
					el.createDiv({
						text: `⚠️ JSON Map Error: ${e.message}. Check console for details.`,
						style: "color:var(--text-error); font-size:0.8em; margin-bottom:5px;"
					});
				}
			}
		} else {
			// Empty source is fine (just no images)
			console.log("[Zotero Assistant] Code block is empty.");
		}

		const container = el.createDiv({ cls: 'zotero-assistant-container' });

		// --- Header ---
		const header = container.createDiv({ cls: 'zotero-assistant-header' });
		header.createEl("h4", { text: "🤖 Zotero Assistant", style: "margin:0;" });
		if (key) header.createEl("code", { text: key, style: "margin-left:10px;" });
		else header.createEl("span", { text: " (No Key Found)", style: "color:var(--text-error);" });

		// --- Buttons ---
		const btnRow = container.createDiv({ cls: 'zotero-assistant-actions', style: "margin: 15px 0; display: flex; gap: 10px;" });

		// Button 1: Fetch/Review
		new ButtonComponent(btnRow)
			.setButtonText(`Fetch / Review Highlights`)
			.setCta()
			.setDisabled(!key)
			.onClick(() => {
				if (key) {
					// Pass the successfully parsed map
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
			btnWebhook.buttonEl.style.opacity = "0.6";
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
		const list = container.createEl("ul");
		list.style.paddingLeft = "20px";

		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed.startsWith('>') && !trimmed.includes('[!')) {
				const text = trimmed.replace(/^>\s*/, '').trim();
				if (text.length > 0) {
					const li = list.createEl("li");
					li.innerText = text.length > 100 ? text.slice(0, 100) + "..." : text;
					li.style.fontSize = "0.9em";
					li.style.color = "var(--text-muted)";
					li.style.marginBottom = "5px";
					found++;
				}
			} else if (trimmed.includes('==')) {
				const matches = trimmed.match(/==(.*?)==/g);
				if (matches) matches.forEach(m => {
					const li = list.createEl("li");
					li.innerText = m.replace(/==/g, '');
					li.style.fontSize = "0.9em";
					li.style.marginBottom = "5px";
					found++;
				});
			}
		}
		if (found === 0) container.createDiv({ text: "No highlights detected.", style: "font-style:italic; color:var(--text-faint);" });
	}
}}
