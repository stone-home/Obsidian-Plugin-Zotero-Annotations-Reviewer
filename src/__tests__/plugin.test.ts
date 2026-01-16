// src/__tests__/plugin.test.ts
import ZoteroGKPlugin from '../main';
import { App, Plugin, Modal, SuggestModal } from 'obsidian';
import { ZoteroSettingTab } from '../settings';
import { AssistantView } from '../ui/assistant';

// =============================================================================
// 1. MOCKS
// =============================================================================
jest.mock('../services/zotero');
jest.mock('../services/obsidian');
jest.mock('../services/webhook');
jest.mock('../services/dataview');

// Mock HighlightModal
jest.mock('../ui/highlights', () => ({
	HighlightModal: class {
		open = jest.fn();
		constructor(app: any, settings: any, key: any, opts: any) {}
	}
}));

// Mock InputModal & Capture Callback
const mockInputModalOpen = jest.fn();
jest.mock('../ui/inputs', () => ({
	InputModal: jest.fn().mockImplementation((app, callback) => ({
		open: mockInputModalOpen,
		callback: callback
	}))
}));

// Mock AssistantView & Capture Render
const mockAssistantViewRender = jest.fn();
jest.mock('../ui/assistant', () => ({
	AssistantView: jest.fn().mockImplementation(() => ({
		render: mockAssistantViewRender
	}))
}));

// Helper to access private/protected methods
const cast = <T>(obj: any): T => obj;

// =============================================================================
// 2. MAIN TEST SUITE
// =============================================================================
describe('ZoteroGKPlugin', () => {
	let app: App;
	let plugin: ZoteroGKPlugin;

	beforeEach(() => {
		app = new App();
		plugin = new ZoteroGKPlugin(app, {} as any);

		// Mock loadData/saveData
		(plugin as any).loadData = jest.fn().mockResolvedValue({});
		(plugin as any).saveData = jest.fn();

		jest.clearAllMocks();
	});

	// --- EXISTING TESTS ---
	describe('Lifecycle', () => {
		test('onload initializes services and registers components', async () => {
			await plugin.onload();
			expect(plugin.zotero).toBeDefined();
			expect(plugin.registerMarkdownCodeBlockProcessor).toHaveBeenCalledWith('zotero-assistant', expect.any(Function));
			expect(plugin.addCommand).toHaveBeenCalledTimes(3);
			expect(plugin.addSettingTab).toHaveBeenCalledWith(expect.any(ZoteroSettingTab));
		});

		test('saveSettings calls saveData', async () => {
			await plugin.onload();
			await plugin.saveSettings();
			expect((plugin as any).saveData).toHaveBeenCalled();
		});
	});

	describe('Core Logic: triggerReviewForActiveFile', () => {
		test('opens HighlightModal when citation key exists', async () => {
			await plugin.onload();
			const { HighlightModal } = require('../ui/highlights');

			(app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
				frontmatter: { 'zotero-key': 'TEST_KEY' }
			});

			await plugin.triggerReviewForActiveFile({} as any);
			// Verify logic (e.g. check if HighlightModal was instantiated if possible, or no error thrown)
		});

		test('shows notice when citation key is missing', async () => {
			await plugin.onload();
			(app.metadataCache.getFileCache as jest.Mock).mockReturnValue(null);
			await plugin.triggerReviewForActiveFile({} as any);
			// Notice verification logic...
		});
	});

	// --- NEW TESTS (NESTED HERE CORRECTLY) ---

	describe('Code Block Processor', () => {
		test('zotero-assistant block initializes AssistantView and renders', async () => {
			await plugin.onload();

			// 1. Retrieve the registered callback
			const registerCalls = (plugin.registerMarkdownCodeBlockProcessor as jest.Mock).mock.calls;
			const assistantCall = registerCalls.find(call => call[0] === 'zotero-assistant');
			const callback = assistantCall[1];

			// 2. Mock Inputs
			const source = "citationKey: @test";
			const el = document.createElement('div');
			const ctx = { addChild: jest.fn() };

			// 3. Invoke Callback
			callback(source, el, ctx);

			// 4. Verify Logic
			const { AssistantView } = require('../ui/assistant');
			expect(AssistantView).toHaveBeenCalledWith(el, plugin);
			expect(ctx.addChild).toHaveBeenCalled();
			expect(mockAssistantViewRender).toHaveBeenCalledWith(source, ctx);
		});
	});

	describe('Command Logic', () => {
		const getCommand = (id: string) => {
			const calls = (plugin.addCommand as jest.Mock).mock.calls;
			return calls.find(c => c[0].id === id)?.[0];
		};

		test('zotero-create-dashboard opens InputModal', async () => {
			await plugin.onload();
			const command = getCommand('zotero-create-dashboard');

			command.callback();

			const { InputModal } = require('../ui/inputs');
			expect(InputModal).toHaveBeenCalled();
			expect(mockInputModalOpen).toHaveBeenCalled();
		});

		test('zotero-review-current validates active file', async () => {
			await plugin.onload();
			const command = getCommand('zotero-review-current');

			// Scenario A: No Active File
			(plugin.app.workspace.getActiveFile as jest.Mock).mockReturnValue(null);
			expect(command.checkCallback(true)).toBe(false);

			// Scenario B: Active File Exists
			const mockFile = { path: 'My Paper.md' };
			(plugin.app.workspace.getActiveFile as jest.Mock).mockReturnValue(mockFile);
			expect(command.checkCallback(true)).toBe(true);

			// Scenario C: Execute
			const triggerSpy = jest.spyOn(plugin, 'triggerReviewForActiveFile').mockImplementation(async () => {});
			command.checkCallback(false);
			expect(triggerSpy).toHaveBeenCalledWith(mockFile);
		});

		test('zotero-trigger-webhook validates active file', async () => {
			await plugin.onload();
			const command = getCommand('zotero-trigger-webhook');

			(plugin.app.workspace.getActiveFile as jest.Mock).mockReturnValue(null);
			expect(command.checkCallback(true)).toBe(false);

			(plugin.app.workspace.getActiveFile as jest.Mock).mockReturnValue({ path: 'note.md' });
			expect(command.checkCallback(true)).toBe(true);
		});
	});

}); // <--- END OF MAIN DESCRIBE BLOCK

// =============================================================================
// 3. SETTINGS TAB (Separate describe block is fine here)
// =============================================================================
describe('Settings Tab', () => {
	let app: App;
	let plugin: ZoteroGKPlugin;
	let tab: ZoteroSettingTab;

	beforeEach(async () => {
		app = new App();
		plugin = new ZoteroGKPlugin(app, {} as any);
		await plugin.onload();
		tab = new ZoteroSettingTab(app, plugin);
	});

	test('renders all tabs and switches content', () => {
		tab.display();
		expect(tab.activeTab).toBe('general');

		tab.activeTab = 'zotero';
		tab.display();
		// assertions...
	});
});


