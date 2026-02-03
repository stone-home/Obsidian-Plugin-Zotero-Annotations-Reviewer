import { ObsidianService } from './obsidian';
import { App, TFile } from 'obsidian';
// @ts-ignore
import { ObsidianNoteFactory } from 'markdown-note-orm';
import { DEFAULT_SETTINGS } from '../types';

// Mock the ORM library completely
jest.mock('markdown-note-orm', () => ({
	ObsidianNoteFactory: {
		createByType: jest.fn(),
		loadAndPatch: jest.fn()
	}
}));

describe('ObsidianService', () => {
	let app: App;
	let service: ObsidianService;
	let mockNoteModel: any;

	beforeEach(() => {
		jest.clearAllMocks();
		app = new App();

		// Mock specific settings needed for paths
		const settings = { ...DEFAULT_SETTINGS, fleetingNoteFolder: 'Fleeting', annotationKeyName: 'anno-key' };
		service = new ObsidianService(app, settings);

		// Setup the Mock Note Object returned by ORM
		mockNoteModel = {
			properties: { set: jest.fn() },
			content: { addSection: jest.fn() },
			addSourceToProps: jest.fn(),
			save: jest.fn().mockResolvedValue(undefined)
		};

		// ORM returns this mock note
		(ObsidianNoteFactory.createByType as jest.Mock).mockResolvedValue(mockNoteModel);
		(ObsidianNoteFactory.loadAndPatch as jest.Mock).mockResolvedValue(mockNoteModel);

		// Mock Vault
		(app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null); // File doesn't exist
		(app.vault.createFolder as jest.Mock).mockResolvedValue(undefined);
	});

	describe('createLiteratureNote', () => {
		it('should create a new literature note if one does not exist', async () => {
			const metadata: any = {
				key: 'key123',
				title: 'Deep Learning',
				creators: ['LeCun'],
				date: '2015',
				abstract: 'Intro to AI'
			};

			await service.createLiteratureNote(metadata);

			// Verify ORM was called to create 'literature' type
			expect(ObsidianNoteFactory.createByType).toHaveBeenCalledWith(
				expect.anything(),
				expect.stringContaining('Fleeting/@key123 - Deep Learning.md'),
				'literature',
				'Deep Learning'
			);

			// Verify properties were set
			expect(mockNoteModel.properties.set).toHaveBeenCalledWith('year', '2015');
			expect(mockNoteModel.save).toHaveBeenCalled();
		});
	});

	describe('saveNote (Fleeting)', () => {
		it('should create a new atomic note from annotation', async () => {
			const annotation: any = {
				key: 'anno1',
				citationKey: 'author2020',
				text: 'Important quote',
				comment: 'My thought'
			};

			await service.saveNote(annotation, 'create');

			expect(ObsidianNoteFactory.createByType).toHaveBeenCalledWith(
				expect.anything(),
				expect.stringContaining('Fleeting/My thought.md'), // Title derived from comment
				'fleeting',
				'My thought'
			);

			expect(mockNoteModel.content.addSection).toHaveBeenCalledWith(
				'Highlight',
				2,
				expect.arrayContaining(["```ad-quote", "title: Modified at undefined", "Important quote", "```"])
			);
		});
	});

	describe('isAnnotationExported', () => {
		it('should return TFile when a note has matching annotation key in frontmatter', async () => {
			const mockFile = new TFile();
			(app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([mockFile]);
			(app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
				frontmatter: { 'anno-key': 'key123' }
			});
			const result = await service.isAnnotationExported('key123');
			expect(result).toBe(mockFile);
		});

		it('should return null when no file has the annotation key', async () => {
			const mockFile = new TFile();
			(app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([mockFile]);
			(app.metadataCache.getFileCache as jest.Mock).mockReturnValue({ frontmatter: { other: 'x' } });
			const result = await service.isAnnotationExported('key123');
			expect(result).toBeNull();
		});
	});

	describe('findLocalImage', () => {
		it('should return file when name includes annotation key', () => {
			const mockImage = { name: 'img-annoKey123.png', extension: 'png' };
			(app.vault.getFiles as jest.Mock).mockReturnValue([mockImage]);
			const ann: any = { key: 'annoKey123' };
			const result = service.findLocalImage(ann);
			expect(result).toBe(mockImage);
		});

		it('should return null when no matching image', () => {
			(app.vault.getFiles as jest.Mock).mockReturnValue([]);
			const ann: any = { key: 'x' };
			expect(service.findLocalImage(ann)).toBeNull();
		});
	});

	describe('createLiteratureNote when file exists', () => {
		it('should load and patch existing note when path exists as TFile', async () => {
			const existingFile = new TFile();
			(app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((p: string) => {
				if (p.includes('Fleeting/@k1')) return existingFile;
				return null;
			});
			(ObsidianNoteFactory.loadAndPatch as jest.Mock).mockResolvedValue(mockNoteModel);
			const metadata: any = { key: 'k1', title: 'Existing Note', creators: [], date: '2020', abstract: '' };
			await service.createLiteratureNote(metadata);
			expect(ObsidianNoteFactory.loadAndPatch).toHaveBeenCalledWith(app, expect.stringContaining('Fleeting'));
			expect(mockNoteModel.save).toHaveBeenCalled();
		});
	});

	describe('saveNote overwrite and append', () => {
		it('should overwrite target note when mode is overwrite', async () => {
			const targetFile = new TFile();
			(targetFile as any).path = 'Fleeting/target.md';
			const annotation: any = { key: 'a1', citationKey: '@c1', text: 'T', comment: 'C', date: '2024', link: 'http://x' };
			mockNoteModel.content.getSection = jest.fn().mockReturnValue({ content: [] });
			await service.saveNote(annotation, 'overwrite', targetFile);
			expect(ObsidianNoteFactory.loadAndPatch).toHaveBeenCalledWith(app, 'Fleeting/target.md');
			expect(mockNoteModel.save).toHaveBeenCalled();
		});

		it('should append to target note when mode is append', async () => {
			const targetFile = new TFile();
			(targetFile as any).path = 'Fleeting/target.md';
			const annotation: any = { key: 'a1', citationKey: '@c1', text: 'T', comment: 'C', date: '2024', link: 'http://x' };
			mockNoteModel.content.getSection = jest.fn().mockReturnValue({ content: [] });
			await service.saveNote(annotation, 'append', targetFile);
			expect(ObsidianNoteFactory.loadAndPatch).toHaveBeenCalledWith(app, 'Fleeting/target.md');
			expect(mockNoteModel.content.addSection).toHaveBeenCalledWith('Highlight', 2, expect.any(Array));
			expect(mockNoteModel.save).toHaveBeenCalled();
		});
	});
});
