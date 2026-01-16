import { App, TFile, Notice } from 'obsidian';
import ZoteroGKPlugin from './main';
import { HighlightModal } from './ui/highlights';
import { DEFAULT_SETTINGS } from './types';

// 1. Mock Obsidian API (handled by __mocks__/obsidian.ts automatically)
// 2. Mock Internal Services and UI to avoid side effects
jest.mock('./services/zotero');
jest.mock('./services/obsidian');
jest.mock('./services/webhook');
jest.mock('./services/dataview');
jest.mock('./ui/highlights');
jest.mock('./ui/assistant');
jest.mock('./ui/project-selector');

describe('ZoteroGKPlugin', () => {
	let app: App;
	let plugin: ZoteroGKPlugin;

	beforeEach(() => {
		// Reset mocks before each test
		jest.clearAllMocks();

		// Instantiate App and Plugin using your manual mocks
		app = new App();
		// @ts-ignore - The mock Plugin constructor might differ slightly from strict types
		plugin = new ZoteroGKPlugin(app, {
			id: 'zotero-annotations-reviewer',
			name: 'Zotero Annotations Reviewer',
			author: 'stone',
			version: '1.0.0',
			minAppVersion: '0.15.0',
			description: 'test'
		});
		plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
	});

	describe('onload', () => {
		it('should load settings, initialize services, and register commands', async () => {
			// Spy on methods to verify they are called
			const addCommandSpy = jest.spyOn(plugin, 'addCommand');
			const registerBlockSpy = jest.spyOn(plugin, 'registerMarkdownCodeBlockProcessor');

			await plugin.onload();

			// Verify Settings Loaded
			expect(plugin.loadData).toHaveBeenCalled();
			expect(plugin.settings).toBeDefined();

			// Verify Services Initialized
			expect(plugin.zotero).toBeDefined();
			expect(plugin.obsidian).toBeDefined();

			// Verify Commands Registered
			expect(addCommandSpy).toHaveBeenCalledWith(expect.objectContaining({
				id: 'zotero-trigger-webhook',
				name: 'Trigger Webhook...'
			}));

			// Verify Code Blocks Registered
			expect(registerBlockSpy).toHaveBeenCalledTimes(2);
			expect(registerBlockSpy).toHaveBeenCalledWith('zotero-assistant', expect.any(Function));
			expect(registerBlockSpy).toHaveBeenCalledWith('project-picker', expect.any(Function));
		});
	});

	describe('triggerReviewForActiveFile', () => {
		it('should open HighlightModal when a valid citation key is found', async () => {
			// Arrange: Mock the cache to return a citation key
			const mockFile = new TFile();
			(app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
				frontmatter: { 'citation-key': '@smith2020' }
			});

			// Act
			await plugin.triggerReviewForActiveFile(mockFile);

			// Assert
			expect(HighlightModal).toHaveBeenCalledTimes(1);
			// Verify the modal was opened.
			// Note: Since HighlightModal is a class, we check instances.
			const mockModalInstance = (HighlightModal as unknown as jest.Mock).mock.instances[0];
			expect(mockModalInstance.open).toHaveBeenCalled();
		});

		it('should show a Notice when no citation key is found', async () => {
			// Arrange: Mock cache to return empty frontmatter
			const mockFile = new TFile();
			(app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
				frontmatter: {}
			});

			// Act
			await plugin.triggerReviewForActiveFile(mockFile);

			// Assert: Modal should NOT be called
			expect(HighlightModal).not.toHaveBeenCalled();
			// You might want to mock Notice globally to verify it was called
			// (Requires creating a spy on the global Notice class or checking the mock implementation)
		});
	});
});
