import { App, Modal, Notice, TFile } from 'obsidian';
import { ZoteroAnnotation, ZoteroItemMetadata, MyPluginSettings } from '../types';
// FIX: Use lowercase filenames to match actual file structure
import { ZoteroService } from '../services/zotero';
import { ObsidianService } from '../services/obsidian';
// FIX: Use 'markdown-note-orm' (consistent with services/obsidian.ts)
import { ObsidianNoteFactory, NoteModel } from 'markdown-note-orm';

export class HighlightModal extends Modal {
	private citationKey: string;
	private zotero: ZoteroService;
	private obsidian: ObsidianService;
	private annotations: ZoteroAnnotation[] = [];
	private itemMetadata: ZoteroItemMetadata | null = null;

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

		// --- 2. Metadata Verification Section ---
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
		// FIX: Removed inline styles, used CSS classes from src/styles.css
		const section = container.createDiv({ cls: 'zotero-metadata-section' });

		const headerDiv = section.createDiv({ cls: 'zotero-metadata-header' });
		headerDiv.createEl("h4", { text: "Metadata Verification", cls: "zotero-no-margin" });

		// Debug Button
		const debugBtn = headerDiv.createEl("button", { text: "🔍 Log Raw Data" });
		debugBtn.setAttribute('title', "Print raw JSON to Developer Console");
		debugBtn.onclick = async () => {
			new Notice("Fetching raw metadata... Check Console");
			const raw = await this.zotero.getRawMetadata(this.citationKey);
			console.group("Zotero Raw Metadata");
			console.log(raw);
			console.groupEnd();
		};

		// Attempt to load the Active Note for verification
		const activeFile = this.app.workspace.getActiveFile();
		let activeNoteModel: NoteModel<any> | null = null;
		let noteLoaded = false;

		if (activeFile) {
			try {
				// FIX: Use ObsidianNoteFactory for cleaner instantiation
				activeNoteModel = await ObsidianNoteFactory.loadAndPatch(this.app, activeFile.path);
				noteLoaded = true;
				section.createDiv({
					text: `Target: ${activeFile.basename}`,
					cls: "zotero-verify-target"
				});
			} catch (e) {
				console.error("Failed to load active note model", e);
			}
		} else {
			section.createDiv({
				text: "⚠️ No active note found. Verification disabled.",
				cls: "zotero-verify-warning"
			});
		}

		const fieldsToCheck = [
			{ label: "Title", zValue: meta.title, propKey: "title" },
			{ label: "Date", zValue: meta.date, propKey: "date" },
			{ label: "Publication", zValue: meta.publication, propKey: "publication" },
			{ label: "Authors", zValue: meta.creators.join(", "), propKey: "authors" },
			{ label: "DOI", zValue: meta.doi, propKey: "doi" },
			{ label: "Publisher", zValue: meta.publisher || "-", propKey: "publisher" },
			{ label: "Pages", zValue: meta.pages || "-", propKey: "pages" }
		];

		const table = section.createEl("table", { cls: 'zotero-metadata-table' });
		const headerRow = table.createEl("tr");
		headerRow.createEl("th", { text: "Field" });
		headerRow.createEl("th", { text: "Zotero Value" });
		headerRow.createEl("th", { text: "Status", cls: "zotero-col-status" });

		for (const field of fieldsToCheck) {
			if (!field.zValue || field.zValue === "-") continue;

			const row = table.createEl("tr");
			row.createEl("td", { text: field.label });

			const displayVal = field.zValue.length > 50 ? field.zValue.substring(0, 48) + "..." : field.zValue;
			row.createEl("td", { text: displayVal, cls: 'zotero-metadata-value' });

			const statusCell = row.createEl("td", { cls: "zotero-cell-center" });

			if (noteLoaded && activeNoteModel) {
				this.renderVerifyButton(statusCell, activeNoteModel, field.propKey, field.zValue, field.label);
			} else {
				statusCell.createSpan({ text: "-" });
			}
		}
	}

	private renderVerifyButton(
		container: HTMLElement,
		model: NoteModel<any>,
		propKey: string,
		zoteroValue: string,
		label: string
	) {
		const btn = container.createEl("button", { text: "Verify" });
		btn.onclick = () => {
			const noteValue = model.properties.get(propKey);
			const normalizedNoteVal = String(noteValue || "").trim().toLowerCase();
			const normalizedZoteroVal = String(zoteroValue || "").trim().toLowerCase();

			const isMatch = normalizedNoteVal === normalizedZoteroVal ||
				(normalizedNoteVal.length > 5 && normalizedZoteroVal.includes(normalizedNoteVal));

			if (isMatch) {
				btn.setText("✅");
				btn.addClass("zotero-text-success");
				btn.setAttr("disabled", "true");
			} else {
				btn.setText("❌");
				btn.addClass("zotero-text-error");
				new Notice(`Mismatch for ${label}!\nZotero: ${zoteroValue}\nNote: ${noteValue || "(empty)"}`);
			}
		};
	}

	async renderAnnotationCard(container: HTMLElement, ann: ZoteroAnnotation) {
		const card = container.createDiv({ cls: 'zotero-card' });
		card.style.borderLeft = `5px solid ${ann.color}`;

		// --- IMAGE LOGIC ---
		let localImageFile: TFile | null = null;

		// 1. Map Lookup
		const mappedPath = this.imageMap[ann.key];
		if (mappedPath) {
			const file = this.app.vault.getAbstractFileByPath(mappedPath);
			if (file instanceof TFile) localImageFile = file;
		}

		// 2. Fallback Search
		if (!localImageFile && (ann.type === 'image' || ann.type === 'ink')) {
			localImageFile = this.obsidian.findLocalImage(ann);
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

		// FIX: Moved 'target' inside 'attr' to fix TS2353
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
