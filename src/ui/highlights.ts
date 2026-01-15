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
			// Fetch Data
			try {
				this.annotations = await this.zotero.getAnnotations(this.citationKey);
			} catch (e) {
				console.error("Annotation fetch failed", e);
				statusEl.setText(`❌ Error fetching annotations: ${(e as Error).message}`);
				return;
			}

			try {
				this.itemMetadata = await this.zotero.getItemMetadata(this.citationKey);
			} catch (e) {
				console.warn("Metadata fetch failed", e);
				new Notice("Metadata fetch failed, but continuing with annotations.");
			}

			statusEl.remove();
			await this.render();

		} catch (e) {
			statusEl.setText(`Critical Error: ${String(e)}`);
			statusEl.addClass("zotero-text-error");
		}
	}

	async render() {
		const { contentEl } = this;
		contentEl.empty();

		// --- 1. Header & Actions ---
		const header = contentEl.createDiv({ cls: "zotero-modal-header-actions" });
		header.createEl("h2", { text: `Review: ${this.citationKey}`, cls: "zotero-no-margin" });

		const btnFetch = header.createEl("button", { text: "📥 Fetch Images" });
		btnFetch.onclick = () => this.triggerZoteroIntegrationImport();

		// --- 2. Metadata Section ---
		const metaContainer = contentEl.createDiv({ cls: 'zotero-metadata-container' });
		if (this.itemMetadata) {
			await this.renderMetadataSection(metaContainer, this.itemMetadata);
		} else {
			metaContainer.createDiv({
				text: "⚠️ Metadata unavailable",
				cls: "zotero-text-muted-italic"
			});
		}

		contentEl.createEl("hr");

		// --- 3. Annotations List ---
		const container = contentEl.createDiv({ cls: 'zotero-list' });
		if (this.annotations.length === 0) {
			container.createDiv({ text: "No annotations found." });
		} else {
			for (const ann of this.annotations) {
				await this.renderAnnotationCard(container, ann);
			}
		}
	}

	async renderMetadataSection(container: HTMLElement, meta: ZoteroItemMetadata) {
		const section = container.createDiv({ cls: 'zotero-metadata-box' });
		const grid = section.createDiv({ cls: 'zotero-metadata-grid' });

		const addRow = (label: string, value: string) => {
			grid.createEl("div", { text: label, cls: "zotero-metadata-label" });
			grid.createEl("div", { text: value || "-" });
		};

		addRow("Title", meta.title);
		addRow("Authors", meta.creators.join(", "));
		addRow("Date", meta.date);
		addRow("Publication", meta.publication);
		if (meta.doi) addRow("DOI", meta.doi);
	}

	async renderAnnotationCard(container: HTMLElement, ann: ZoteroAnnotation) {
		const card = container.createDiv({ cls: 'zotero-card' });
		card.style.borderLeft = `5px solid ${ann.color}`;

		// --- IMAGE LOGIC ---
		let localImageFile: TFile | null = null;
		let sourceInfo = "";

		// 1. Map Lookup
		const mappedPath = this.imageMap[ann.key];
		if (mappedPath) {
			const file = this.app.vault.getAbstractFileByPath(mappedPath);
			if (file instanceof TFile) {
				localImageFile = file;
				sourceInfo = "via JSON Map";
			}
		}

		// 2. Fallback Search
		if (!localImageFile && (ann.type === 'image' || ann.type === 'ink')) {
			localImageFile = this.obsidian.findLocalImage(ann);
			if (localImageFile) sourceInfo = "via Search";
		}

		// --- Render Image ---
		if (localImageFile) {
			const imgContainer = card.createDiv({ cls: "zotero-img-container" });
			const imgEl = imgContainer.createEl("img");
			imgEl.src = this.app.vault.getResourcePath(localImageFile);
			imgEl.addClass("zotero-card-img");

			imgContainer.createDiv({
				text: `📷 ${localImageFile.name}`,
				cls: "zotero-img-caption"
			});
		} else if (ann.type === 'image' || ann.type === 'ink') {
			const placeholder = card.createDiv({ cls: "zotero-img-placeholder" });
			placeholder.createDiv({ text: "📷 Image Not Found" });
			const btn = placeholder.createEl("button", { text: "📥 Fetch via Zotero Integration" });
			btn.style.marginTop = "10px";
			btn.onclick = () => this.triggerZoteroIntegrationImport();
		}

		// --- Content ---
		if (ann.text) card.createEl("blockquote", { text: ann.text, cls: "zotero-blockquote-no-margin" });
		if (ann.comment) card.createDiv({ text: `📝 ${ann.comment}`, cls: "zotero-comment-italic" });

		// --- Footer ---
		const footer = card.createDiv({ cls: "zotero-card-footer" });

		const leftFooter = footer.createDiv({ cls: "zotero-footer-left" });
		leftFooter.createSpan({ text: `Page ${ann.pageLabel}` });

		// --- FIX: target moved inside attr ---
		leftFooter.createEl("a", {
			text: "Open PDF",
			href: ann.link,
			attr: { target: "_blank" }
		});

		// --- Actions ---
		const rightFooter = footer.createDiv();
		const btnCreate = rightFooter.createEl("button", { text: "Create Note", cls: "mod-cta" });
		btnCreate.onclick = async () => {
			await this.obsidian.saveNote(ann, 'create', undefined, localImageFile);
			new Notice("Fleeting Note Created!");
		};
	}

	async triggerZoteroIntegrationImport() {
		// @ts-ignore: Accessing external plugin
		const plugin = this.app.plugins.getPlugin('obsidian-zotero-desktop-connector');
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
