import { MarkdownPostProcessorContext, MarkdownRenderChild, TFile, ButtonComponent, Notice } from 'obsidian';
import * as obsidian from 'obsidian';
import ZoteroGKPlugin from '../main';
import { HighlightModal } from './highlights';
import { parseImageMap } from '../utils/parser';
import { ZoteroConnectorService} from "../services/zotero-connector";

export class AssistantView extends MarkdownRenderChild {
	plugin: ZoteroGKPlugin;
	private zoteroConnector: ZoteroConnectorService

	constructor(containerEl: HTMLElement, plugin: ZoteroGKPlugin) {
		super(containerEl);
		this.plugin = plugin;
		this.zoteroConnector = new ZoteroConnectorService(this.plugin.app, this.plugin.settings);
	}

	async render(source: string, ctx: MarkdownPostProcessorContext) {
		const el = this.containerEl;
		const file = this.plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);

		if (!(file instanceof TFile)) {
			el.createDiv({ text: "Assistant only works in notes." });
			return;
		}

		// 1. Parse Image Map (Legacy/Standard feature)
		let imageMap = parseImageMap(source);

		const container = el.createDiv({ cls: 'zotero-assistant-container' });

		// Header
		const header = container.createDiv({ cls: 'zotero-assistant-header' });
		header.createEl("h4", { text: "🤖 Zotero Assistant", cls: "zotero-title" });

		// Actions
		const btnRow = container.createDiv({ cls: 'zotero-assistant-actions' });
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const key = cache?.frontmatter?.[this.plugin.settings.citationKeyName] ||
			cache?.frontmatter?.['zotero-key'] ||
			cache?.frontmatter?.['citation-key'];

		// Review Button
		const updateBtn = new ButtonComponent(btnRow)
			.setButtonText("Update Metadata")
			.setIcon("lucide-refresh-cw")
			.setDisabled(!key)
			.onClick(() => this.zoteroConnector.triggerZoteroIntegrationImport(key));
		updateBtn.buttonEl.addClass("zotero-btn-fancy");

		const reviewBtn = new ButtonComponent(btnRow)
			.setButtonText(`Review Highlights`)
			.setIcon("highlighter")
			.setDisabled(!key)
			.onClick(() => {
				if (key) new HighlightModal(
					this.plugin.app,
					this.plugin.settings,
					key,
					imageMap, async () => {
						await this.render(source, ctx);
					}).open();
			});
		reviewBtn.buttonEl.addClass("zotero-btn-fancy");

		// Webhook Buttons
		if (this.plugin.settings.webhooks.length > 0) {
			this.plugin.settings.webhooks.forEach(hook => {
				if (hook.hidden) return;
				const btn = new ButtonComponent(btnRow)
					.setButtonText(hook.name)
					.setIcon(hook.icon || "plane")
					.onClick(async () => {
						await this.plugin.webhookService.triggerWebhook(hook, file);
					});
				btn.buttonEl.addClass("zotero-btn-fancy", "zotero-btn-secondary");
			});
		}

		// --- Local Highlights / Script Execution ---
		container.createEl("hr");
		container.createEl("h5", { text: "📝 Related Notes / Highlights" });
		const highlightsDiv = container.createDiv({ cls: 'zotero-local-highlights' });

		// Pass 'source' to parse parameters for the script
		await this.renderLocalHighlights(file, highlightsDiv, source);

		// --- CFP context section ---
		container.createEl("hr");
		container.createEl("h5", { text: "📅 CFP context" });
		const cfpDiv = container.createDiv({ cls: 'zotero-cfp-context' });
		await this.renderCFPContext(file, cfpDiv);
	}

	async renderLocalHighlights(file: TFile, container: HTMLElement, source: string) {
		const customScript = this.plugin.settings.assistantScript;

		if (customScript && customScript.trim().length > 0) {
			if (this.plugin.dataviewService.isAvailable) {

				// --- PARSING LOGIC (Requested) ---
				const lines = source.trim().split("\n");
				// lines[0] is theoretically the script ID, but we currently use the settings script.
				// We still parse it to be consistent with your request structure.
				const params: Record<string, any> = {};

				lines.slice(1).forEach((line) => {
					const [key, value] = line.split(/[=:]/).map((s) => s.trim());
					if (key && value) {
						try {
							params[key] = JSON.parse(value);
						} catch {
							params[key] = value.replace(/^["']|["']$/g, "");
						}
					}
				});

				// Execute with Params
				await this.plugin.dataviewService.executeScript(
					customScript,
					container,
					this,
					file.path,
					params // Inject { input: params }
				);
			} else {
				container.createDiv({
					text: "⚠️ Dataview plugin not found. Please install Dataview.",
					cls: "zotero-text-muted-italic"
				});
			}
			return;
		}

		// Fallback Logic...
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

	/** Render CFP context for the current note based on existing CFP notes in the vault. */
	private async renderCFPContext(file: TFile, container: HTMLElement): Promise<void> {
		if (!this.plugin.cfpService) {
			container.createDiv({
				text: "CFP service not available.",
				cls: "zotero-text-muted-italic"
			});
			return;
		}

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) {
			container.createDiv({
				text: "No metadata found for CFP matching.",
				cls: "zotero-text-muted-italic"
			});
			return;
		}

		const conferenceName = (fm['conferenceName'] ?? fm['conference'] ?? fm['title'] ?? '').toString() || undefined;
		const proceedingsTitle = (fm['proceedingsTitle'] ?? fm['publication'] ?? '').toString() || undefined;
		const place = (fm['place'] ?? fm['location'] ?? '').toString() || undefined;
		const acronymKey = this.plugin.settings.cfpAcronymKey?.trim() || 'conference-acronym';
		let acronymFromNote = (fm[acronymKey] ?? '').toString().trim() || undefined;
		// Fallback: try common keys so template users don't have to configure (e.g. acronym, conference_acronym).
		if (!acronymFromNote) {
			acronymFromNote = (fm['acronym'] ?? fm['conference_acronym'] ?? fm['conferenceAbbrev'] ?? '').toString().trim() || undefined;
		}
		let year: number | undefined;
		const rawYear = fm['year'] ?? fm['date'];
		if (typeof rawYear === 'number') {
			year = rawYear;
		} else if (typeof rawYear === 'string') {
			const m = rawYear.match(/\b(20\d{2}|19\d{2})\b/);
			if (m) year = parseInt(m[1], 10);
		}

		if (!conferenceName && !proceedingsTitle && !acronymFromNote) {
			container.createDiv({
				text: "No conference title or acronym in this note.",
				cls: "zotero-text-muted-italic"
			});
			return;
		}

		try {
			const match = await this.plugin.cfpService.findBestMatchingCFPForConference({
				conferenceName,
				proceedingsTitle,
				place,
				year,
				acronymFromNote
			});

			// Case 1: We have a concrete event match → render full event + series info.
			if (match.event) {
				const event = match.event.item;

				const titleEl = container.createDiv({ cls: 'zotero-cfp-title' });
				titleEl.createSpan({ text: event.acronym, cls: 'zotero-cfp-acronym' });
				if (event.fullName && event.fullName !== event.acronym) {
					titleEl.createSpan({ text: ` — ${event.fullName}`, cls: 'zotero-cfp-fullname' });
				}

				const metaList = container.createEl('ul', { cls: 'zotero-cfp-meta' });
				const dateText = event.start && event.end
					? `${event.start} → ${event.end}`
					: (event.start || event.end || 'N/A');
				const dateLi = metaList.createEl('li');
				dateLi.createSpan({ text: `Dates: ${dateText}` });

				if (event.location) {
					const locLi = metaList.createEl('li');
					locLi.createSpan({ text: `Location: ${event.location}` });
				}

				if (event.series && match.seriesNotePath) {
					const seriesLi = metaList.createEl('li');
					seriesLi.createSpan({ text: 'Series: ' });
					const link = seriesLi.createEl('a', {
						text: `${event.series} Series`,
						href: '#'
					});
					link.onclick = (ev) => {
						ev.preventDefault();
						const target = this.plugin.app.vault.getAbstractFileByPath(match.seriesNotePath!);
						if (target instanceof TFile) {
							this.plugin.app.workspace.getLeaf().openFile(target);
						} else {
							new Notice('Series note not found.');
						}
					};
				}

				if (match.latestSeriesDdl) {
					const ddlLi = metaList.createEl('li');
					ddlLi.createSpan({ text: `Latest submission deadline in this series: ${match.latestSeriesDdl}` });
				}
				return;
			}

			// Case 2: No specific event, but we found a Series note → show Series-only context.
			if (!match.event && match.seriesNotePath) {
				const seriesFile = this.plugin.app.vault.getAbstractFileByPath(match.seriesNotePath);
				const seriesBase = seriesFile instanceof TFile
					? seriesFile.basename.replace(/\s+Series$/i, '')
					: match.seriesNotePath.split('/').pop()?.replace(/\.md$/, '').replace(/\s+Series$/i, '') ?? 'Series';

				const titleEl = container.createDiv({ cls: 'zotero-cfp-title' });
				titleEl.createSpan({ text: seriesBase, cls: 'zotero-cfp-acronym' });
				titleEl.createSpan({ text: ' — Series overview', cls: 'zotero-cfp-fullname' });

				const metaList = container.createEl('ul', { cls: 'zotero-cfp-meta' });
				const seriesLi = metaList.createEl('li');
				seriesLi.createSpan({ text: 'Series note: ' });
				const link = seriesLi.createEl('a', {
					text: `${seriesBase} Series`,
					href: '#'
				});
				link.onclick = (ev) => {
					ev.preventDefault();
					if (seriesFile instanceof TFile) {
						this.plugin.app.workspace.getLeaf().openFile(seriesFile);
					} else {
						new Notice('Series note not found.');
					}
				};

				if (match.latestSeriesDdl) {
					const ddlLi = metaList.createEl('li');
					ddlLi.createSpan({ text: `Latest submission deadline in this series: ${match.latestSeriesDdl}` });
				}

				return;
			}

			// Case 3: Nothing at all.
			const hint = acronymFromNote
				? ` (acronym from note: "${acronymFromNote}"; check CFP folder and [CFP] in console)`
				: ' (optional: set conference-acronym or acronym in frontmatter for direct match)';
			container.createDiv({
				text: "No related CFP found in your CFP folder." + hint,
				cls: "zotero-text-muted-italic"
			});
		} catch (e) {
			console.error('[CFP] renderCFPContext failed', e);
			container.createDiv({
				text: "Failed to load CFP context. See console.",
				cls: "zotero-text-muted-italic"
			});
		}
	}
}
