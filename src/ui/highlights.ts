import { App, Modal, Notice, TFile } from 'obsidian';
import { ZoteroAnnotation, ZoteroItemMetadata, MyPluginSettings } from '../types';
import { ZoteroService } from '../services/zotero';
import { ObsidianService } from '../services/obsidian';

export class HighlightModal extends Modal {
	private citationKey: string;
	private zotero: ZoteroService;
	private obsidian: ObsidianService;
	private annotations: ZoteroAnnotation[] = [];
	private itemMetadata: ZoteroItemMetadata | null = null;

	// Key: Annotation ID, Value: Image Path
	private imageMap: Record<string, string>;

	private exportedCache: Set<string> = new Set();

	constructor(
		app: App,
		settings: MyPluginSettings,
		citationKey: string,
		imageMap: Record<string, string> = {}
	) {
		super(app);
		this.citationKey = citationKey;
		this.imageMap = imageMap;
		this.zotero = new ZoteroService(settings.zoteroPort);
		this.obsidian = new ObsidianService(app, settings);
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: `Review: ${this.citationKey}` });

		const statusEl = contentEl.createDiv({ cls: 'zotero-status' });
		statusEl.setText("Fetching data from Zotero...");

		try {
			// Debug Logs
			console.log(`[Zotero Debug] Key: ${this.citationKey}`);
			console.log(`[Zotero Debug] Map:`, this.imageMap);

			try {
				this.annotations = await this.zotero.getAnnotations(this.citationKey);
			} catch (e) {
				statusEl.setText(`❌ Error fetching annotations: ${e.message}`);
				return;
			}

			try {
				this.itemMetadata = await this.zotero.getItemMetadata(this.citationKey);
			} catch (e) {
				new Notice("Metadata fetch failed, but continuing with annotations.");
			}

			statusEl.remove();
			await this.render();

		} catch (e) {
			statusEl.setText(`Critical Error: ${String(e)}`);
			statusEl.style.color = "var(--text-error)";
		}
	}

	async render() {
		const { contentEl } = this;
		contentEl.empty();

		const header = contentEl.createDiv({ style: "display:flex; justify-content:space-between;" });
		header.createEl("h2", { text: `Review: ${this.citationKey}`, style: "margin:0;" });

		const btnFetch = header.createEl("button", { text: "📥 Fetch Images" });
		btnFetch.onclick = () => this.triggerZoteroIntegrationImport();

		if (this.itemMetadata) {
			const metaDiv = contentEl.createDiv({ style: 'background:var(--background-secondary); padding:10px; margin:10px 0; border-radius:4px;' });
			metaDiv.createDiv({ text: `Title: ${this.itemMetadata.title}`, style: "font-weight:bold;" });
		}

		contentEl.createEl("hr");

		const container = contentEl.createDiv({ cls: 'zotero-list' });
		if (this.annotations.length === 0) {
			container.createDiv({ text: "No annotations found." });
		} else {
			for (const ann of this.annotations) {
				await this.renderAnnotationCard(container, ann);
			}
		}
	}

	async renderAnnotationCard(container: HTMLElement, ann: ZoteroAnnotation) {
		const card = container.createDiv({ cls: 'zotero-card', style: 'border:1px solid var(--background-modifier-border); padding:10px; margin-bottom:10px;' });
		card.style.borderLeft = `5px solid ${ann.color}`;

		// --- IMAGE LOGIC ---
		let localImageFile: TFile | null = null;
		let sourceInfo = "";

		console.error(this.imageMap)
		// 1. Map Lookup (Primary Strategy)
		// Uses the ID from the Zotero API (ann.key) to look up the path from the JSON map
		const mappedPath = this.imageMap[ann.key];
		if (mappedPath) {
			const file = this.app.vault.getAbstractFileByPath(mappedPath);
			if (file instanceof TFile) {
				localImageFile = file;
				sourceInfo = "Matched via JSON Map";
			} else {
				console.warn(`[Zotero] Map path not found: ${mappedPath}`);
			}
		}

		// 2. Fallback Search
		if (!localImageFile && (ann.type === 'image' || ann.type === 'ink')) {
			localImageFile = this.obsidian.findLocalImage(ann);
			if (localImageFile) sourceInfo = "Matched via Fallback Search";
		}

		// --- Render ---
		if (localImageFile) {
			const imgEl = card.createEl("img");
			imgEl.src = this.app.vault.getResourcePath(localImageFile);
			imgEl.style.maxWidth = "100%";
			imgEl.style.maxHeight = "300px";
			card.createDiv({ text: `📷 ${sourceInfo}: ${localImageFile.name}`, style: "font-size:0.7em; color:green;" });
		} else if (ann.type === 'image' || ann.type === 'ink') {
			const placeholder = card.createDiv({ style: "background:var(--background-secondary); padding:20px; text-align:center;" });
			placeholder.createDiv({ text: "📷 Image Not Found" });
			const btn = placeholder.createEl("button", { text: "Fetch via Zotero Integration" });
			btn.onclick = () => this.triggerZoteroIntegrationImport();
		}

		if (ann.text) card.createEl("blockquote", { text: ann.text });
		if (ann.comment) card.createDiv({ text: `📝 ${ann.comment}` });

		// Actions
		const btnRow = card.createDiv({ style: "margin-top:10px;" });
		const btnCreate = btnRow.createEl("button", { text: "Create Note", cls: "mod-cta" });
		btnCreate.onclick = async () => {
			await this.obsidian.saveNote(ann, 'create', undefined, localImageFile);
			new Notice("Note Created");
		};
	}

	async triggerZoteroIntegrationImport() {
		const plugin = (this.app as any).plugins.getPlugin('obsidian-zotero-desktop-connector');
		if (plugin) {
			const fmt = plugin.settings.exportFormats?.find((f:any) => f.name.includes('Obsidian')) || plugin.settings.exportFormats[0];
			if(fmt) await plugin.runImport(fmt.name, this.citationKey);
		} else {
			new Notice("Zotero Integration plugin not enabled.");
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
