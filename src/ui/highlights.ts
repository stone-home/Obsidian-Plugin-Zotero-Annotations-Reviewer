import { App, Modal, Setting, Notice } from 'obsidian';
import { ZoteroAnnotation, ZoteroItemMetadata, MyPluginSettings } from '../types';
import { ZoteroService } from '../services/zotero';
import { ObsidianService } from '../services/obsidian';
import { NoteModel, ObsidianVaultAdapter } from 'markdown-note-orm';


export class HighlightModal extends Modal {
	private citationKey: string;
	private zotero: ZoteroService;
	private obsidian: ObsidianService;
	private annotations: ZoteroAnnotation[] = [];
	private itemMetadata: ZoteroItemMetadata | null = null;

	// Cache for instantly updating UI state without waiting for file system indexing
	private exportedCache: Set<string> = new Set();

	constructor(app: App, settings: MyPluginSettings, citationKey: string) {
		super(app);
		this.citationKey = citationKey;
		this.zotero = new ZoteroService(settings.zoteroPort);
		this.obsidian = new ObsidianService(app, settings);
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: `Review: ${this.citationKey}` });
		const loadingEl = contentEl.createDiv({ text: "Fetching data from Zotero..." });

		try {
			// Fetch Metadata and Annotations in parallel
			const [meta, annots] = await Promise.all([
				this.zotero.getItemMetadata(this.citationKey),
				this.zotero.getAnnotations(this.citationKey)
			]);

			this.itemMetadata = meta;
			this.annotations = annots;

			loadingEl.remove();
			await this.render();
		} catch (e) {
			loadingEl.setText(`Error: ${String(e)}`);
			loadingEl.style.color = "var(--text-error)";
		}
	}

	async render() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: `Review: ${this.citationKey}` });

		// --- SECTION 1: Metadata Verification ---
		if (this.itemMetadata) {
			await this.renderMetadataSection(contentEl, this.itemMetadata);
		} else {
			contentEl.createDiv({ text: "⚠️ Could not fetch item metadata.", cls: "zotero-note-content" });
		}

		contentEl.createEl("hr");

		// --- SECTION 2: Zotero Child Notes (e.g. TL;DR) ---
		if (this.itemMetadata?.zoteroNotes && this.itemMetadata.zoteroNotes.length > 0) {
			contentEl.createEl("h3", { text: `Zotero Notes (${this.itemMetadata.zoteroNotes.length})` });
			const notesContainer = contentEl.createDiv();

			for (const note of this.itemMetadata.zoteroNotes) {
				const noteCard = notesContainer.createDiv({ cls: 'zotero-note-container' });
				noteCard.createEl("strong", { text: `📑 ${note.title}` });
				noteCard.createDiv({
					text: note.cleanContent.slice(0, 200) + (note.cleanContent.length > 200 ? "..." : ""),
					cls: 'zotero-note-content'
				});
			}
			contentEl.createEl("hr");
		}

		// --- SECTION 3: Annotations List ---
		contentEl.createEl("h3", { text: `Annotations (${this.annotations.length})` });
		const container = contentEl.createDiv({ cls: 'zotero-annotation-list' });

		if (this.annotations.length === 0) {
			container.createDiv({ text: "No annotations found." });
		} else {
			for (const ann of this.annotations) {
				await this.renderAnnotationCard(container, ann);
			}
		}
	}

	async renderMetadataSection(container: HTMLElement, meta: ZoteroItemMetadata) {
		const section = container.createDiv({ cls: 'zotero-metadata-section' });

		const headerDiv = section.createDiv({ cls: 'zotero-metadata-header' });
		headerDiv.createEl("h4", { text: "Metadata Verification (Active Note)", style: "margin:0;" });

		// Debug Button
		const debugBtn = headerDiv.createEl("button", { text: "🔍 Log Raw Data" });
		debugBtn.title = "Print raw JSON to Developer Console";
		debugBtn.onclick = async () => {
			new Notice("Fetching raw metadata... Check Console (Ctrl+Shift+I)");
			const raw = await this.zotero.getRawMetadata(this.citationKey);
			console.group("Zotero Raw Metadata");
			console.log(raw);
			console.groupEnd();
			new Notice("Raw data logged to console.");
		};

		// Attempt to load the Active Note for verification
		const activeFile = this.app.workspace.getActiveFile();
		let activeNoteModel: any = null;
		let noteLoaded = false;

		if (activeFile) {
			try {
				const adapter = new ObsidianVaultAdapter(this.app);
				activeNoteModel = await NoteModel.load(adapter, activeFile.path);
				noteLoaded = true;
				section.createDiv({ text: `Target: ${activeFile.basename}`, style: "font-size:0.8em; color:var(--text-muted); margin-bottom:10px;" });
			} catch (e) {
				console.error("Failed to load active note model", e);
			}
		} else {
			section.createDiv({ text: "⚠️ No active note found. Verification disabled.", style: "color:var(--text-warning); margin-bottom:10px;" });
		}

		// Fields to verify
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
		const header = table.createEl("tr");
		header.createEl("th", { text: "Field" });
		header.createEl("th", { text: "Zotero Value" });
		header.createEl("th", { text: "Status", style: "text-align:center; width:100px;" });

		for (const field of fieldsToCheck) {
			// Skip purely empty optional fields
			if (!field.zValue || field.zValue === "-") continue;

			const row = table.createEl("tr");
			row.createEl("td", { text: field.label });

			const displayVal = field.zValue.length > 50 ? field.zValue.substring(0, 48) + "..." : field.zValue;
			row.createEl("td", { text: displayVal, cls: 'zotero-metadata-value' });

			const statusCell = row.createEl("td", { style: "text-align:center;" });

			if (noteLoaded && activeNoteModel) {
				const btn = statusCell.createEl("button", { text: "Verify" });
				btn.onclick = () => {
					const noteValue = activeNoteModel.properties.get(field.propKey);
					const normalizedNoteVal = String(noteValue || "").trim().toLowerCase();
					const normalizedZoteroVal = String(field.zValue || "").trim().toLowerCase();

					// Loose matching logic
					const isMatch = normalizedNoteVal === normalizedZoteroVal ||
						(normalizedNoteVal.length > 5 && normalizedZoteroVal.includes(normalizedNoteVal));

					if (isMatch) {
						btn.setText("✅ Match");
						btn.style.color = "var(--text-success)";
						btn.disabled = true;
					} else {
						btn.setText("❌ Mismatch");
						btn.style.color = "var(--text-error)";
						new Notice(`Mismatch for ${field.label}!\nZotero: ${field.zValue}\nNote: ${noteValue || "(empty)"}`);
					}
				};
			} else {
				statusCell.createSpan({ text: "-" });
			}
		}
	}

	async renderAnnotationCard(container: HTMLElement, ann: ZoteroAnnotation) {
		const card = container.createDiv({ cls: 'zotero-card' });

		// Dynamically set the border color based on annotation color
		card.style.borderLeft = `5px solid ${ann.color}`;

		// --- 1. Content Rendering (Text vs Image) ---
		if (ann.type === 'image') {
			// Render Image Placeholder for Area/Image annotations
			const placeholder = card.createDiv({ cls: 'zotero-image-placeholder' });
			placeholder.createDiv({ text: "📷", cls: 'zotero-image-icon' });
			placeholder.createDiv({ text: "Image/Area Annotation" });
			placeholder.createDiv({
				text: "(Images cannot be extracted directly. Click 'Open PDF' to view.)",
				style: "font-size:0.8em; margin-top:4px;"
			});
		} else {
			// Render Text (Blockquote)
			const text = ann.text || "[No Text Selected]";
			card.createEl("blockquote", {
				text: text,
				cls: 'zotero-card-blockquote'
			});
		}

		// --- 2. Comment ---
		if (ann.comment) {
			card.createDiv({ text: `📝 ${ann.comment}`, cls: 'zotero-card-comment' });
		}

		// --- 3. Footer (Metadata & Link) ---
		const metaDiv = card.createDiv({ cls: 'zotero-card-meta' });
		metaDiv.createSpan({ text: `Page: ${ann.pageLabel}` });
		// Standard external link behavior
		const link = metaDiv.createEl("a", { text: "Open PDF ↗", href: ann.link });
		link.setAttr("target", "_blank");

		// --- 4. Status Check & Actions ---

		// Check local cache first (fastest), then fallback to file system
		let isExported = this.exportedCache.has(ann.key);
		if (!isExported) {
			const file = await this.obsidian.isAnnotationExported(ann.key);
			if (file) isExported = true;
		}

		const actionsDiv = card.createDiv({ cls: 'zotero-card-actions' });

		if (isExported) {
			actionsDiv.createSpan({ text: "✅ Exported", cls: 'zotero-status-exported' });

			// Append button (always available if exported)
			const btnAppend = actionsDiv.createEl("button", { text: "Append" });
			btnAppend.onclick = async () => {
				const file = await this.obsidian.isAnnotationExported(ann.key);
				if (file) {
					await this.obsidian.appendToNote(ann, file);
					new Notice("Appended to note!");
				}
			};

			// Rewrite button (Warning)
			const btnRewrite = actionsDiv.createEl("button", { text: "Rewrite" });
			btnRewrite.classList.add("mod-warning"); // Obsidian warning style
			btnRewrite.onclick = async () => {
				const file = await this.obsidian.isAnnotationExported(ann.key);
				await this.obsidian.saveNote(ann, 'overwrite', file || undefined);
			};

		} else {
			// Create Note Button
			const btnCreate = actionsDiv.createEl("button", { text: "Create Note", cls: "mod-cta" });
			btnCreate.onclick = async () => {
				// 1. Create the note
				await this.obsidian.saveNote(ann, 'create');

				// 2. Update local cache immediately so UI reflects change
				this.exportedCache.add(ann.key);

				// 3. Re-render the modal to show "Exported" state
				await this.render();
			};
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
