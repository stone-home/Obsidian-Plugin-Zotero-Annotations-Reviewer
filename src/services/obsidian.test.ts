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
				expect.arrayContaining(['> Important quote'])
			);
		});
	});
});
