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
	private imageMap: Record<string, string>;

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
			try {
				this.annotations = await this.zotero.getAnnotations(this.citationKey);
			} catch (e) {
				statusEl.setText(`❌ Error fetching annotations: ${(e as Error).message}`);
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
			statusEl.addClass("zotero-text-error");
		}
	}

	async render() {
		const { contentEl } = this;
		contentEl.empty();

		const header = contentEl.createDiv({ cls: "zotero-modal-header" });
		header.createEl("h2", { text: `Review: ${this.citationKey}`, cls: "zotero-no-margin" });

		const btnFetch = header.createEl("button", { text: "📥 Fetch Images" });
		btnFetch.onclick = () => this.triggerZoteroIntegrationImport();

		if (this.itemMetadata) {
			const metaDiv = contentEl.createDiv({ cls: 'zotero-meta-box' });
			metaDiv.createDiv({ text: `Title: ${this.itemMetadata.title}`, cls: "zotero-font-bold" });
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
		const card = container.createDiv({ cls: 'zotero-card' });
		// Dynamic style is fine here, but we could also use css vars
		card.style.borderLeft = `5px solid ${ann.color}`;

		// --- IMAGE LOGIC ---
		let localImageFile: TFile | null = null;
		let sourceInfo = "";

		const mappedPath = this.imageMap[ann.key];
		if (mappedPath) {
			const file = this.app.vault.getAbstractFileByPath(mappedPath);
			if (file instanceof TFile) {
				localImageFile = file;
				sourceInfo = "Matched via JSON Map";
			}
		}

		if (!localImageFile && (ann.type === 'image' || ann.type === 'ink')) {
			localImageFile = this.obsidian.findLocalImage(ann);
			if (localImageFile) sourceInfo = "Matched via Fallback Search";
		}

		// --- Render ---
		if (localImageFile) {
			const imgEl = card.createEl("img", { cls: "zotero-card-img" });
			imgEl.src = this.app.vault.getResourcePath(localImageFile);

			card.createDiv({
				text: `📷 ${sourceInfo}: ${localImageFile.name}`,
				cls: "zotero-img-source"
			});
		} else if (ann.type === 'image' || ann.type === 'ink') {
			const placeholder = card.createDiv({ cls: "zotero-img-placeholder" });
			placeholder.createDiv({ text: "📷 Image Not Found" });
			const btn = placeholder.createEl("button", { text: "Fetch via Zotero Integration" });
			btn.onclick = () => this.triggerZoteroIntegrationImport();
		}

		if (ann.text) card.createEl("blockquote", { text: ann.text });
		if (ann.comment) card.createDiv({ text: `📝 ${ann.comment}` });

		// Actions
		const btnRow = card.createDiv({ cls: "zotero-card-actions" });
		const btnCreate = btnRow.createEl("button", { text: "Create Note", cls: "mod-cta" });
		btnCreate.onclick = async () => {
			// Passed localImageFile which is TFile | null. Matches function signature.
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
}
