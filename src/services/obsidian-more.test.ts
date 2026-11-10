import { ObsidianService } from './obsidian';
import { App, TFile } from 'obsidian';
// @ts-ignore
import { ObsidianNoteFactory } from 'markdown-note-orm';
import { DEFAULT_SETTINGS } from '../types';

jest.mock('markdown-note-orm', () => ({
	ObsidianNoteFactory: {
		createByType: jest.fn(),
		loadAndPatch: jest.fn(),
	},
}));

describe('ObsidianService additional coverage', () => {
	let app: App;
	let service: ObsidianService;
	let note: any;

	const annotation: any = {
		key: 'anno1',
		citationKey: 'author2020',
		text: 'Quote',
		comment: 'Thought',
		date: '2024-01-01',
		link: 'zotero://open-pdf/1',
	};

	beforeEach(() => {
		jest.clearAllMocks();
		app = new App();
		const settings = {
			...DEFAULT_SETTINGS,
			fleetingNoteFolder: 'Fleeting',
			annotationKeyName: 'anno-key',
			citationKeyName: 'cite-key',
		};
		service = new ObsidianService(app, settings);
		note = {
			properties: { set: jest.fn() },
			content: { addSection: jest.fn(), getSection: jest.fn() },
			addSourceToProps: jest.fn(),
			save: jest.fn().mockResolvedValue(undefined),
		};
		(ObsidianNoteFactory.createByType as jest.Mock).mockResolvedValue(note);
		(ObsidianNoteFactory.loadAndPatch as jest.Mock).mockResolvedValue(note);
		(app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);
	});

	describe('saveNote', () => {
		it('does nothing for overwrite or append without a target file', async () => {
			await service.saveNote(annotation, 'overwrite');
			await service.saveNote(annotation, 'append');

			expect(ObsidianNoteFactory.loadAndPatch).not.toHaveBeenCalled();
			expect(ObsidianNoteFactory.createByType).not.toHaveBeenCalled();
			expect(note.save).not.toHaveBeenCalled();
		});

		it('picks the first free numbered path when the note name is taken', async () => {
			const taken = new Set([
				'Fleeting/Annotation-author2020-anno1.md',
				'Fleeting/Annotation-author2020-anno1-1.md',
			]);
			(app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
				(p: string) => (taken.has(p) ? new TFile() : null)
			);

			await service.saveNote(annotation, 'create');

			expect(ObsidianNoteFactory.createByType).toHaveBeenCalledWith(
				app,
				'Fleeting/Annotation-author2020-anno1-2.md',
				'fleeting',
				'Annotation-author2020-anno1'
			);
		});

		it('links the active file with its folder as source and writes all sections', async () => {
			(app.workspace.getActiveFile as jest.Mock).mockReturnValue({
				basename: 'Paper',
				parent: { path: 'Literature' },
			});
			const image = new TFile() as any;
			image.path = 'img/shot.png';

			await service.saveNote(annotation, 'create', undefined, image);

			expect(note.addSourceToProps).toHaveBeenCalledWith('[[Literature/Paper]]');
			expect(note.properties.set).toHaveBeenCalledWith('anno-key', 'anno1');
			expect(note.properties.set).toHaveBeenCalledWith('cite-key', 'author2020');
			expect(note.content.addSection).toHaveBeenCalledWith('Highlight', 2, [
				'```ad-quote',
				'title: Modified at 2024-01-01',
				'Quote',
				'```',
				'',
				'![[img/shot.png]]',
			]);
			expect(note.content.addSection).toHaveBeenCalledWith('Thoughts', 2, [
				'Comment at 2024-01-01',
				'Thought',
			]);
			expect(note.content.addSection).toHaveBeenCalledWith('Source', 2, [
				'[PDF](zotero://open-pdf/1)',
			]);
			expect(note.save).toHaveBeenCalledTimes(1);
		});

		it('links a root-level active file by basename only', async () => {
			(app.workspace.getActiveFile as jest.Mock).mockReturnValue({
				basename: 'Paper',
				parent: { path: '/' },
			});

			await service.saveNote({ ...annotation, comment: '' }, 'create');

			expect(note.addSourceToProps).toHaveBeenCalledWith('[[Paper]]');
			expect(note.content.addSection).not.toHaveBeenCalledWith(
				'Thoughts',
				2,
				expect.anything()
			);
		});

		it('clears existing sections on overwrite and embeds the image', async () => {
			const highlight = { content: ['old highlight'] };
			const thoughts = { content: ['old thought'] };
			note.content.getSection.mockImplementation((name: string) =>
				name === 'Highlight' ? highlight : thoughts
			);
			const target = new TFile() as any;
			target.path = 'Fleeting/target.md';
			const image = new TFile() as any;
			image.path = 'img/shot.png';

			await service.saveNote(annotation, 'overwrite', target, image);

			expect(highlight.content).toEqual([]);
			expect(thoughts.content).toEqual([]);
			expect(note.content.addSection).toHaveBeenCalledWith(
				'Highlight',
				2,
				expect.arrayContaining(['Quote', '![[img/shot.png]]'])
			);
		});

		it('keeps existing sections on append and tolerates missing sections on overwrite', async () => {
			const target = new TFile() as any;
			target.path = 'Fleeting/target.md';

			await service.saveNote({ ...annotation, comment: '' }, 'append', target);
			expect(note.content.getSection).not.toHaveBeenCalled();

			note.content.getSection.mockReturnValue(undefined);
			await service.saveNote({ ...annotation, comment: '' }, 'overwrite', target);

			expect(note.content.addSection).toHaveBeenCalledTimes(2);
			expect(note.save).toHaveBeenCalledTimes(2);
		});
	});

	describe('findLocalImage', () => {
		const img = (name: string, extension = 'png') => ({ name, extension });

		it('matches by citation key, page and rounded coordinates', () => {
			const wrongCitation = img('other2021-p3-x10-y21.png');
			const wrongPage = img('author2020-p9-x10-y21.png');
			const wrongCoords = img('author2020-p3-x99-y21.png');
			const notImage = img('author2020-p3-x10-y21.pdf', 'pdf');
			const match = img('author2020-p3-x10-y21.JPG', 'JPG');
			(app.vault.getFiles as jest.Mock).mockReturnValue([
				wrongCitation,
				wrongPage,
				wrongCoords,
				notImage,
				match,
			]);

			const result = service.findLocalImage({
				...annotation,
				position: { pageIndex: 2, rects: [[10.4, 20.6, 50, 60]] },
			});

			expect(result).toBe(match);
		});

		it('accepts the "-page-" naming and defaults to page 1 without pageIndex', () => {
			const match = img('author2020-1-x5y7.jpeg', 'jpeg');
			(app.vault.getFiles as jest.Mock).mockReturnValue([match]);

			expect(
				service.findLocalImage({
					...annotation,
					position: { rects: [[5, 7, 9, 9]] },
				})
			).toBe(match);
		});

		it('returns null when coordinates match no image or rects are empty', () => {
			(app.vault.getFiles as jest.Mock).mockReturnValue([
				img('author2020-p1-x1-y1.png'),
			]);

			expect(
				service.findLocalImage({
					...annotation,
					position: { pageIndex: 0, rects: [[8, 8, 9, 9]] },
				})
			).toBeNull();
			expect(
				service.findLocalImage({
					...annotation,
					position: { pageIndex: 0, rects: [] },
				})
			).toBeNull();
		});
	});

	describe('createLiteratureNote', () => {
		it('skips folder creation when the folder exists and omits the abstract section when empty', async () => {
			(app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
				(p: string) => (p === 'Fleeting' ? {} : null)
			);

			await service.createLiteratureNote({
				key: 'K1',
				title: 'A/B: Title?',
				creators: ['Doe'],
				date: '2021',
				publication: 'Venue',
				url: 'http://x',
			} as any);

			expect(app.vault.createFolder).not.toHaveBeenCalled();
			expect(ObsidianNoteFactory.createByType).toHaveBeenCalledWith(
				app,
				'Fleeting/@K1 - AB Title.md',
				'literature',
				'A/B: Title?'
			);
			expect(note.properties.set).toHaveBeenCalledWith('zotero-key', 'K1');
			expect(note.properties.set).toHaveBeenCalledWith('authors', ['Doe']);
			expect(note.properties.set).toHaveBeenCalledWith('publication', 'Venue');
			expect(note.content.addSection).not.toHaveBeenCalled();
		});
	});
});
