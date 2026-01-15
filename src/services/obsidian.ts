import { App, TFile, normalizePath, Notice } from 'obsidian';
import { ZoteroAnnotation, MyPluginSettings } from '../types';

// CHANGED: Import directly from the NPM package
import { ObsidianNoteFactory, ZettelNoteModel, NoteType } from 'markdown-note-orm';

export class ObsidianService {
	private app: App;
	private settings: MyPluginSettings;

	constructor(app: App, settings: MyPluginSettings) {
		this.app = app;
		this.settings = settings;
	}

	/**
	 * Check if an annotation has already been exported.
	 */
	async isAnnotationExported(annotationKey: string): Promise<TFile | null> {
		const files = this.app.vault.getMarkdownFiles();
		const folder = this.settings.fleetingNoteFolder;

		for (const file of files) {
			if (!file.path.startsWith(folder)) continue;

			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter && cache.frontmatter['zotero-annotation-key'] === annotationKey) {
				return file;
			}
		}
		return null;
	}

	/**
	 * Create or Overwrite a Note using the NoteFactory
	 */
	async saveNote(annotation: ZoteroAnnotation, mode: 'create' | 'overwrite', targetFile?: TFile): Promise<void> {
		let note: ZettelNoteModel<any>;

		if (mode === 'create') {
			const path = await this.getUniquePath(annotation);

			// Factory Pattern: Create a new 'fleeting' note
			note = await ObsidianNoteFactory.createByType(
				this.app,
				path,
				'fleeting',
				this.generateTitle(annotation)
			);

			this.setNoteProperties(note, annotation);
			this.setNoteContent(note, annotation);

			new Notice("Fleeting note created via MKNote Lib.");

		} else if (mode === 'overwrite' && targetFile) {
			// Load existing note into the Model
			note = await ObsidianNoteFactory.loadAndPatch(
				this.app,
				targetFile.path
			);

			this.setNoteProperties(note, annotation);
			this.setNoteContent(note, annotation);

			new Notice("Note updated.");
		} else {
			return;
		}

		// Persist to disk
		await note.save();
	}

	/**
	 * Append to an existing note
	 */
	async appendToNote(annotation: ZoteroAnnotation, targetFile: TFile): Promise<void> {
		// Load the model
		const note = await ObsidianNoteFactory.loadAndPatch(
			this.app,
			targetFile.path
		);

		// Add a new Update section
		const dateStr = new Date().toLocaleDateString();
		const updateLines = [
			`> ${annotation.text}`,
			"",
			`**Comment**: ${annotation.comment}`
		];

		note.content.addSection(`Update (${dateStr})`, 2, updateLines);

		await note.save();
		new Notice("Content appended.");
	}

	// --- Helpers ---

	private generateTitle(annotation: ZoteroAnnotation): string {
		return annotation.comment
			? annotation.comment.slice(0, 30).replace(/[\\/:*?"<>|]/g, "").trim()
			: `Annotation-${annotation.key}`;
	}

	private async getUniquePath(annotation: ZoteroAnnotation): Promise<string> {
		const folder = this.settings.fleetingNoteFolder;

		if (!this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		const baseName = this.generateTitle(annotation);
		let path = normalizePath(`${folder}/${baseName}.md`);

		let i = 1;
		while (this.app.vault.getAbstractFileByPath(path)) {
			path = normalizePath(`${folder}/${baseName}-${i}.md`);
			i++;
		}
		return path;
	}

	private setNoteProperties(note: ZettelNoteModel<any>, annotation: ZoteroAnnotation) {
		note.properties.set('zotero-annotation-key', annotation.key);
		note.properties.set('zotero-citation-key', annotation.citationKey);

		const currentTags = note.properties.get('tags') || [];
		if (!currentTags.includes('zotero-import')) {
			note.properties.set('tags', [...currentTags, 'zotero-import']);
		}
	}

	private setNoteContent(note: ZettelNoteModel<any>, annotation: ZoteroAnnotation) {
		note.content.addSection('Highlight', 2, [
			"> [!quote]",
			`> ${annotation.text}`
		]);

		if (annotation.comment) {
			note.content.addSection('Thoughts', 2, [
				annotation.comment
			]);
		}

		note.content.addSection('Source', 2, [
			`- **PDF**: [${annotation.attachmentTitle}](${annotation.link})`,
			`- **Page**: ${annotation.pageLabel}`
		]);
	}
}
