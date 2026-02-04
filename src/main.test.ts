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
			expect(registerBlockSpy).toHaveBeenCalledTimes(3);
			expect(registerBlockSpy).toHaveBeenCalledWith('zotero-assistant', expect.any(Function));
			expect(registerBlockSpy).toHaveBeenCalledWith('project-picker', expect.any(Function));
			expect(registerBlockSpy).toHaveBeenCalledWith('cfp-list', expect.any(Function));
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
		});

		it('should use citationKeyName from settings when present', async () => {
			plugin.settings.citationKeyName = 'my-key';
			const mockFile = new TFile();
			(app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
				frontmatter: { 'my-key': '@custom2020' }
			});
			await plugin.triggerReviewForActiveFile(mockFile);
			expect(HighlightModal).toHaveBeenCalledWith(app, plugin.settings, '@custom2020', {});
		});

		it('should fallback to zotero-key then citation-key', async () => {
			const mockFile = new TFile();
			(app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
				frontmatter: { 'zotero-key': '@zotero2020' }
			});
			await plugin.triggerReviewForActiveFile(mockFile);
			expect(HighlightModal).toHaveBeenCalledWith(app, plugin.settings, '@zotero2020', {});
		});
	});

	describe('loadSettings', () => {
		it('should merge DEFAULT_SETTINGS with loaded data', async () => {
			(plugin.loadData as jest.Mock).mockResolvedValue({ zoteroPort: 9999 });
			await plugin.loadSettings();
			expect(plugin.settings.zoteroPort).toBe(9999);
			expect(plugin.settings.annotationKeyName).toBe(DEFAULT_SETTINGS.annotationKeyName);
		});
	});

	describe('saveSettings', () => {
		it('should call saveData with current settings', async () => {
			await plugin.saveSettings();
			expect(plugin.saveData).toHaveBeenCalledWith(plugin.settings);
		});
	});

	describe('updateWebhookRibbonIcon', () => {
		it('should remove existing ribbon icon when called', () => {
			plugin.settings.webhookShowInRibbon = true;
			plugin.updateWebhookRibbonIcon();
			const firstEl = (plugin.addRibbonIcon as jest.Mock).mock.results[0]?.value;
			expect(firstEl).toBeDefined();
			plugin.updateWebhookRibbonIcon();
			expect(firstEl.remove).toHaveBeenCalled();
		});

		it('should add ribbon icon when webhookShowInRibbon is true', () => {
			plugin.settings.webhookShowInRibbon = true;
			plugin.updateWebhookRibbonIcon();
			expect(plugin.addRibbonIcon).toHaveBeenCalledWith('webhook', 'Trigger Webhook...', expect.any(Function));
		});

		it('should not add ribbon icon when webhookShowInRibbon is false', () => {
			plugin.settings.webhookShowInRibbon = false;
			plugin.updateWebhookRibbonIcon();
			expect(plugin.addRibbonIcon).not.toHaveBeenCalled();
		});
	});
});
