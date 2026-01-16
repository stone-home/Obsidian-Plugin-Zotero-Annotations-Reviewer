import { App, Modal, Notice, TFile} from 'obsidian';
import { ZoteroAnnotation, ZoteroItemMetadata, MyPluginSettings } from '../types';
import { ZoteroService } from '../services/zotero';
import { ObsidianService } from '../services/obsidian';
import { ObsidianNoteFactory, NoteModel } from 'markdown-note-orm';

export class HighlightModal extends Modal {
	private citationKey: string;
	private settings: MyPluginSettings;
	private zotero: ZoteroService;
	private obsidian: ObsidianService;
	private annotations: ZoteroAnnotation[] = [];
	private itemMetadata: ZoteroItemMetadata | null = null;
	private imageMap: Record<string, string>;
	onUpdate?: () => void;

	constructor(
		app: App,
		settings: MyPluginSettings,
		citationKey: string,
		imageMap: Record<string, string> = {},
		onUpdate?: () => void
	) {
		super(app);
		this.citationKey = citationKey;
		this.settings = settings;
		this.imageMap = imageMap;
		this.zotero = new ZoteroService(settings.zoteroPort);
		this.obsidian = new ObsidianService(app, settings);
		this.onUpdate = onUpdate;
	}

	async onOpen() {
		this.modalEl.addClass("zotero-reviewer-modal");
		const { contentEl } = this;
		contentEl.empty();

		// Initial Header
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
				new Notice("Metadata fetch failed, but continuing.");
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

		const header = contentEl.createDiv({ cls: "zotero-modal-header-actions" });
		header.createEl("h2", { text: `Review: ${this.citationKey}`, cls: "zotero-no-margin" });

		const btnFetch = header.createEl("button", { text: "📥 Fetch Images" });
		btnFetch.addClass("zotero-btn-fancy");
		btnFetch.onclick = () => this.triggerZoteroIntegrationImport();

		const metaContainer = contentEl.createDiv({ cls: 'zotero-metadata-container' });
		if (this.itemMetadata) {
			await this.renderMetadataSection(metaContainer, this.itemMetadata);
		}

		contentEl.createEl("hr");

		const container = contentEl.createDiv({ cls: 'zotero-list' });
		if (this.annotations.length === 0) {
			container.createDiv({ text: "No annotations found." });
		} else {
			// --- SORTING LOGIC ---
			const sortProp = this.settings.sortProperty || 'color';

			this.annotations.sort((a, b) => {
				// @ts-ignore: Dynamic property access
				const valA = (a[sortProp] || "").toString().toLowerCase();
				// @ts-ignore
				const valB = (b[sortProp] || "").toString().toLowerCase();

				// Special handling for Page Label (try numeric sort if possible)
				if (sortProp === 'pageLabel') {
					const numA = parseFloat(valA);
					const numB = parseFloat(valB);
					if (!isNaN(numA) && !isNaN(numB)) {
						return numA - numB;
					}
				}

				if (valA < valB) return -1;
				if (valA > valB) return 1;
				return 0;
			});

			for (const ann of this.annotations) {
				await this.renderAnnotationCard(container, ann);
			}
		}
	}

	async renderMetadataSection(container: HTMLElement, meta: ZoteroItemMetadata) {
		const section = container.createDiv({ cls: 'zotero-metadata-section' });

		const headerDiv = section.createDiv({ cls: 'zotero-metadata-header' });
		headerDiv.createEl("h4", { text: "Metadata Verification", cls: "zotero-no-margin" });

		const debugBtn = headerDiv.createEl("button", { text: "🔍 Log Raw Data" });
		debugBtn.addClass("zotero-btn-subtle");
		debugBtn.setAttribute('title', "Print raw JSON to Developer Console");
		debugBtn.onclick = async () => {
			const raw = await this.zotero.getRawMetadata(this.citationKey);
			console.log(raw);
			new Notice("Logged to Console");
		};

		const activeFile = this.app.workspace.getActiveFile();
		let activeNoteModel: NoteModel<any> | null = null;
		let noteLoaded = false;

		if (activeFile) {
			try {
				// Using ObsidianNoteFactory from markdown-note-orm
				activeNoteModel = await ObsidianNoteFactory.loadAndPatch(this.app, activeFile.path);
				noteLoaded = true;
				section.createDiv({ text: `Target: ${activeFile.basename}`, cls: "zotero-verify-target" });
			} catch (e) { console.error(e); }
		} else {
			section.createDiv({ text: "⚠️ No active note found.", cls: "zotero-verify-warning" });
		}

		const table = section.createEl("table", { cls: 'zotero-metadata-table' });
		const headerRow = table.createEl("tr");
		headerRow.createEl("th", { text: "Field" });
		headerRow.createEl("th", { text: "Zotero Value" });
		headerRow.createEl("th", { text: "Status", cls: "zotero-col-status" });

		const mapping = this.settings.metadataMapping || [];

		for (const mapItem of mapping) {
			if (!mapItem.enabled) continue;

			// @ts-ignore
			let zValue = meta[mapItem.zoteroProp];
			if (Array.isArray(zValue)) zValue = zValue.join(", ");
			if (!zValue) zValue = "-";
			zValue = String(zValue);

			const row = table.createEl("tr");
			row.createEl("td", { text: mapItem.label, cls: "zotero-cell-label" });

			const displayVal = zValue.length > 50 ? zValue.substring(0, 48) + "..." : zValue;
			row.createEl("td", { text: displayVal, cls: 'zotero-metadata-value' });

			const statusCell = row.createEl("td", { cls: "zotero-cell-center" });

			if (noteLoaded && activeNoteModel) {
				this.renderVerifyButton(statusCell, activeNoteModel, mapItem.noteProp, zValue, mapItem.label);
			} else {
				statusCell.createSpan({ text: "-" });
			}
		}
	}

	private renderVerifyButton(container: HTMLElement, model: NoteModel<any>, propKey: string, zVal: string, label: string) {
		const btn = container.createEl("button", { text: "Verify" });
		btn.addClass("zotero-btn-small");
		btn.onclick = () => {
			const nVal = String(model.properties.get(propKey) || "").trim().toLowerCase();
			const zNorm = zVal.trim().toLowerCase();
			const isMatch = nVal === zNorm || (nVal.length > 5 && zNorm.includes(nVal));

			if (isMatch) {
				btn.setText("✅");
				btn.addClass("zotero-text-success");
				btn.setAttr("disabled", "true");
			} else {
				btn.setText("❌");
				btn.addClass("zotero-text-error");
				new Notice(`Mismatch for ${label}`);
			}
		};
	}

	async renderAnnotationCard(container: HTMLElement, ann: ZoteroAnnotation) {
		const card = container.createDiv({ cls: 'zotero-card' });
		card.style.borderLeft = `6px solid ${ann.color}`;

		let localImageFile: TFile | null = null;
		// Check Map
		if (this.imageMap[ann.key]) {
			const f = this.app.vault.getAbstractFileByPath(this.imageMap[ann.key]);
			if (f instanceof TFile) localImageFile = f;
		}
		// Check Heuristic
		if (!localImageFile && (ann.type === 'image' || ann.type === 'ink')) {
			localImageFile = this.obsidian.findLocalImage(ann);
		}

		if (localImageFile) {
			const imgContainer = card.createDiv({ cls: "zotero-img-container" });
			const imgEl = imgContainer.createEl("img");
			imgEl.src = this.app.vault.getResourcePath(localImageFile);
			imgEl.addClass("zotero-card-img");
			imgContainer.createDiv({ text: `📷 ${localImageFile.name}`, cls: "zotero-img-caption" });
		} else if (ann.type === 'image' || ann.type === 'ink') {
			const p = card.createDiv({ cls: "zotero-img-placeholder" });
			p.createDiv({ text: "📷 Image Not Found" });
			const btn = p.createEl("button", { text: "📥 Fetch" });
			btn.addClass("zotero-btn-fancy", "zotero-btn-small");
			btn.onclick = () => this.triggerZoteroIntegrationImport();
		}

		if (ann.text) card.createEl("blockquote", { text: ann.text, cls: "zotero-blockquote-no-margin" });
		if (ann.comment) card.createDiv({ text: `📝 ${ann.comment}`, cls: "zotero-comment-italic" });

		const footer = card.createDiv({ cls: "zotero-card-footer" });
		const left = footer.createDiv({ cls: "zotero-footer-left" });
		left.createSpan({ text: `Page ${ann.pageLabel}` });
		left.createEl("a", { text: "Open PDF", href: ann.link, attr: { target: "_blank" } });

		const right = footer.createDiv({ cls: "zotero-footer-right" });

		const existingNote = await this.obsidian.isAnnotationExported(ann.key);

		if (existingNote) {
			const btnOpen = right.createEl("button", { text: "Open Note" });
			btnOpen.addClass("zotero-btn-fancy", "zotero-btn-secondary");
			btnOpen.onclick = async () => {
				await this.app.workspace.getLeaf(true).openFile(existingNote);
				this.close();
			};
		} else {
			const btnCreate = right.createEl("button", { text: "Create Note", cls: "mod-cta" });
			btnCreate.addClass("zotero-btn-fancy");
			btnCreate.onclick = async () => {
				const scrollPos = this.contentEl.scrollTop;
				await this.obsidian.saveNote(ann, 'create', undefined, localImageFile);
				new Notice("Note Created");
				await sleep(200);
				await this.render();
				this.contentEl.scrollTop = scrollPos;
			};
		}
	}

	async triggerZoteroIntegrationImport() {
		// @ts-ignore
		const plugin = this.app.plugins.getPlugin('obsidian-zotero-desktop-connector');
		if(plugin && plugin.settings.exportFormats) {
			const fmt = plugin.settings.exportFormats[0];
			if(fmt) await plugin.runImport(fmt.name, this.citationKey);
			new Notice("Triggered Zotero Integration Import");
		} else {
			new Notice("Obsidian Zotero Desktop Connector plugin not found or configured.");
		}
	}
}
