import { App, TFile, normalizePath, Notice } from 'obsidian';
import { ZoteroAnnotation, ZoteroItemMetadata, MyPluginSettings } from '../types';
import { ObsidianNoteFactory, ZettelNoteModel } from 'markdown-note-orm';

export class ObsidianService {
	private app: App;
	private settings: MyPluginSettings;

	constructor(app: App, settings: MyPluginSettings) {
		this.app = app;
		this.settings = settings;
	}

	/**
	 * Create/Update the Dashboard Note (Literature Note)
	 */
	async createLiteratureNote(metadata: ZoteroItemMetadata): Promise<TFile> {
		const fileName = metadata.title.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60);
		const path = normalizePath(`${this.settings.fleetingNoteFolder}/@${metadata.key} - ${fileName}.md`);

		let note: ZettelNoteModel<any>;
		const existing = this.app.vault.getAbstractFileByPath(path);

		if (existing instanceof TFile) {
			note = await ObsidianNoteFactory.loadAndPatch(this.app, path);
		} else {
			if (!this.app.vault.getAbstractFileByPath(this.settings.fleetingNoteFolder)) {
				await this.app.vault.createFolder(this.settings.fleetingNoteFolder);
			}
			note = await ObsidianNoteFactory.createByType(this.app, path, 'literature', metadata.title);
		}

		note.properties.set('zotero-key', metadata.key);
		note.properties.set('authors', metadata.creators);
		note.properties.set('year', metadata.date);
		note.properties.set('publication', metadata.publication);
		note.properties.set('url', metadata.url);

		if (metadata.abstract) {
			note.content.addSection('Abstract', 2, [metadata.abstract]);
		}

		await note.save();
		return this.app.vault.getAbstractFileByPath(path) as TFile;
	}

	/**
	 * Create Atomic Fleeting Note
	 */
	async saveNote(
		annotation: ZoteroAnnotation,
		mode: 'create' | 'overwrite',
		targetFile?: TFile,
		imageFile?: TFile | null
	): Promise<void> {
		let note: ZettelNoteModel<any>;

		if (mode === 'create') {
			const path = await this.getUniquePath(annotation);
			note = await ObsidianNoteFactory.createByType(this.app, path, 'fleeting', this.generateTitle(annotation));
			this.setNoteContent(note, annotation, imageFile || null);
		} else if (mode === 'overwrite' && targetFile) {
			note = await ObsidianNoteFactory.loadAndPatch(this.app, targetFile.path);
			this.setNoteContent(note, annotation, imageFile || null);
		} else { return; }

		await note.save();
	}

	async appendToNote(annotation: ZoteroAnnotation, targetFile: TFile, imageFile?: TFile | null): Promise<void> {
		const note = await ObsidianNoteFactory.loadAndPatch(this.app, targetFile.path);
		const dateStr = new Date().toLocaleDateString();

		const lines = [`> ${annotation.text}`, "", `**Comment**: ${annotation.comment}`];
		if (imageFile) lines.push("", `![[${imageFile.path}]]`);

		note.content.addSection(`Update (${dateStr})`, 2, lines);
		await note.save();
		new Notice("Appended.");
	}

	/**
	 * Checks if a note for this annotation already exists in the vault.
	 * Scans all markdown files for the 'zotero-annotation-key' frontmatter property.
	 */
	async isAnnotationExported(key: string): Promise<TFile | null> {
		const files = this.app.vault.getMarkdownFiles();
		for (const f of files) {
			const cache = this.app.metadataCache.getFileCache(f);
			if (cache?.frontmatter?.['zotero-annotation-key'] === key) {
				return f;
			}
		}
		return null;
	}

	findLocalImage(annotation: ZoteroAnnotation): TFile | null {
		const files = this.app.vault.getFiles();
		const imageFiles = files.filter(f => ['png','jpg','jpeg'].includes(f.extension.toLowerCase()));

		// Strategy 1: Check for Annotation Key
		const keyMatch = imageFiles.find(f => f.name.includes(annotation.key));
		if (keyMatch) return keyMatch;

		// Strategy 2: Coordinate Match (Standard Zotero Integration Format)
		if (annotation.position && annotation.position.rects && annotation.position.rects.length > 0) {
			const rect = annotation.position.rects[0];
			const targetX = Math.round(rect[0]);
			const targetY = Math.round(rect[1]);
			const targetPage = (annotation.position.pageIndex || 0) + 1;

			return imageFiles.find(f => {
				const name = f.name;
				if (!name.includes(annotation.citationKey)) return false;
				if (!name.includes(`p${targetPage}`) && !name.includes(`-${targetPage}-`)) return false;
				return name.includes(`x${targetX}`) && name.includes(`y${targetY}`);
			}) || null;
		}

		return null;
	}

	private setNoteContent(note: ZettelNoteModel<any>, ann: ZoteroAnnotation, img: TFile | null) {
		note.properties.set('zotero-annotation-key', ann.key);
		note.properties.set('zotero-citation-key', ann.citationKey);

		const lines = ["> [!quote]", `> ${ann.text}`];
		if (img) lines.push("", `![[${img.path}]]`);

		note.content.addSection('Highlight', 2, lines);
		if (ann.comment) note.content.addSection('Thoughts', 2, [ann.comment]);
		note.content.addSection('Source', 2, [`[PDF](${ann.link})`]);
	}

	private generateTitle(ann: ZoteroAnnotation): string {
		return ann.comment ? ann.comment.slice(0, 30).replace(/[\\/:*?"<>|]/g, "").trim() : `Annotation-${ann.key}`;
	}

	private async getUniquePath(ann: ZoteroAnnotation): Promise<string> {
		const base = this.generateTitle(ann);
		let path = normalizePath(`${this.settings.fleetingNoteFolder}/${base}.md`);
		let i = 1;
		while (this.app.vault.getAbstractFileByPath(path)) {
			path = normalizePath(`${this.settings.fleetingNoteFolder}/${base}-${i}.md`);
			i++;
		}
		return path;
	}
}
