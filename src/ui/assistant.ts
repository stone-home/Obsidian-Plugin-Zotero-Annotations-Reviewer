import { MarkdownPostProcessorContext, MarkdownRenderChild, TFile, ButtonComponent, Notice, normalizePath } from 'obsidian';
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

	/** Render CFP context from Conference acronym key (plain string or wiki link). */
	private async renderCFPContext(file: TFile, container: HTMLElement): Promise<void> {
		if (!this.plugin.cfpService) {
			container.createDiv({ text: "CFP service not available.", cls: "zotero-text-muted-italic" });
			return;
		}

		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm) {
			container.createDiv({ text: "No metadata found for CFP matching.", cls: "zotero-text-muted-italic" });
			return;
		}

		const acronymKey = this.plugin.settings.cfpAcronymKey?.trim() || 'conference-acronym';
		let raw = (fm[acronymKey] ?? '').toString().trim();
		if (!raw) {
			raw = (fm['acronym'] ?? fm['conference_acronym'] ?? fm['conferenceAbbrev'] ?? '').toString().trim();
		}
		if (!raw) {
			container.createDiv({ text: "No conference acronym in this note.", cls: "zotero-text-muted-italic" });
			return;
		}

		// Parse: plain string or [[link]]
		const linkMatch = raw.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
		const cfpDir = (this.plugin.settings.cfpNoteDir || 'CFP').trim() || 'CFP';
		const cfpDirPrefix = normalizePath(cfpDir + '/');

		try {
			if (!linkMatch) {
				// Plain string: find series by acronym
				const seriesInfo = this.plugin.cfpService.getSeriesInfoByAcronym(raw);
				if (!seriesInfo) {
					container.createDiv({ text: `No matching series in CFP folder for "${raw}".`, cls: "zotero-text-muted-italic" });
					return;
				}
				this.renderSeriesBlock(container, seriesInfo.seriesName, seriesInfo.seriesNotePath, seriesInfo.latestEvent);
				return;
			}

			// Link: resolve using Obsidian's link resolution
			const linkPath = linkMatch[1].trim();
			const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
			const targetFile = resolved ?? this.plugin.app.vault.getAbstractFileByPath(
				normalizePath(linkPath.endsWith('.md') ? linkPath : linkPath + '.md')
			);
			if (!targetFile || !(targetFile instanceof TFile)) {
				container.createDiv({ text: "Could not resolve link to a note.", cls: "zotero-text-muted-italic" });
				return;
			}
			if (!targetFile.path.startsWith(cfpDirPrefix)) {
				container.createDiv({ text: "Link is not under CFP folder.", cls: "zotero-text-muted-italic" });
				return;
			}

			const info = this.plugin.cfpService.getCFPNoteInfoByPath(targetFile.path);
			if (!info) {
				container.createDiv({ text: "Could not load CFP note info.", cls: "zotero-text-muted-italic" });
				return;
			}

			if (info.isSeries) {
				this.renderSeriesBlock(container, info.seriesName, info.seriesNotePath, info.latestEvent);
			} else {
				this.renderEventBlock(container, info.event, info.latestEvent);
			}
		} catch (e) {
			console.error('[CFP] renderCFPContext failed', e);
			container.createDiv({ text: "Failed to load CFP context. See console.", cls: "zotero-text-muted-italic" });
		}
	}

	/** Create a clickable link that opens a file. */
	private createFileLink(parent: HTMLElement, text: string, path: string, cls?: string): HTMLAnchorElement {
		const link = parent.createEl('a', { text, href: '#', cls });
		link.onclick = (ev) => {
			ev.preventDefault();
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) this.plugin.app.workspace.getLeaf().openFile(file);
			else new Notice('Note not found.');
		};
		return link;
	}

	/** Render series block with link and latest conference info. */
	private renderSeriesBlock(container: HTMLElement, seriesName: string, seriesNotePath: string, latestEvent?: { item: { acronym: string; submissionDdl?: string; location?: string }; path: string }): void {
		const titleEl = container.createDiv({ cls: 'zotero-cfp-title' });
		titleEl.createSpan({ text: seriesName, cls: 'zotero-cfp-acronym' });
		titleEl.createSpan({ text: ' — Series overview', cls: 'zotero-cfp-fullname' });

		const metaList = container.createEl('ul', { cls: 'zotero-cfp-meta' });
		const seriesLi = metaList.createEl('li');
		seriesLi.createSpan({ text: 'Series note: ' });
		this.createFileLink(seriesLi, `${seriesName} Series`, seriesNotePath);
		if (latestEvent) {
			const latestLi = metaList.createEl('li');
			latestLi.createSpan({ text: 'Latest: ' });
			this.createFileLink(latestLi, latestEvent.item.acronym, latestEvent.path);
			const details: string[] = [];
			if (latestEvent.item.submissionDdl) details.push(`DDL: ${latestEvent.item.submissionDdl}`);
			if (latestEvent.item.location) details.push(latestEvent.item.location);
			if (details.length) latestLi.createSpan({ text: ` (${details.join(', ')})` });
		} else {
			metaList.createEl('li').createSpan({ text: 'No conferences found.', cls: 'zotero-text-muted-italic' });
		}
	}

	/** Render event block with dates/location and latest conference info in series. */
	private renderEventBlock(container: HTMLElement, event: { item: { acronym: string; fullName: string; start?: string; end?: string; location: string }; path: string }, latestEvent?: { item: { acronym: string; submissionDdl?: string; location?: string }; path: string }): void {
		const titleEl = container.createDiv({ cls: 'zotero-cfp-title' });
		this.createFileLink(titleEl, event.item.acronym, event.path, 'zotero-cfp-acronym');
		if (event.item.fullName && event.item.fullName !== event.item.acronym) {
			titleEl.createSpan({ text: ` — ${event.item.fullName}`, cls: 'zotero-cfp-fullname' });
		}

		const metaList = container.createEl('ul', { cls: 'zotero-cfp-meta' });
		const dateText = event.item.start && event.item.end ? `${event.item.start} → ${event.item.end}` : (event.item.start || event.item.end || 'N/A');
		metaList.createEl('li').createSpan({ text: `Dates: ${dateText}` });
		if (event.item.location) metaList.createEl('li').createSpan({ text: `Location: ${event.item.location}` });

		// Show latest conference in series with submission deadline and location
		if (latestEvent && latestEvent.path !== event.path) {
			const latestLi = metaList.createEl('li');
			latestLi.createSpan({ text: 'Latest in series: ' });
			this.createFileLink(latestLi, latestEvent.item.acronym, latestEvent.path);
			const details: string[] = [];
			if (latestEvent.item.submissionDdl) details.push(`DDL: ${latestEvent.item.submissionDdl}`);
			if (latestEvent.item.location) details.push(latestEvent.item.location);
			if (details.length) latestLi.createSpan({ text: ` (${details.join(', ')})` });
		}
	}
}
