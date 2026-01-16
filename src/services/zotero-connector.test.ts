import { ZoteroConnectorService } from './zotero-connector';
import { App, Notice } from 'obsidian';
import { DEFAULT_SETTINGS } from '../types';

jest.mock('obsidian', () => ({
	...jest.requireActual('obsidian'),
	Notice: jest.fn()
}));

describe('ZoteroConnectorService', () => {
	let app: App;
	let service: ZoteroConnectorService;
	let mockConnectorPlugin: any;

	beforeAll(() => {
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		jest.spyOn(console, 'error').mockImplementation(() => {});
	});

	// 2. Restore console logs after tests finish (Critical!)
	afterAll(() => {
		jest.restoreAllMocks();
	});

	beforeEach(() => {
		app = new App();
		mockConnectorPlugin = {
			settings: { exportFormats: [{ name: 'Markdown' }] },
			runImport: jest.fn()
		};

		(app as any).plugins = {
			getPlugin: jest.fn()
		};

		service = new ZoteroConnectorService(app, DEFAULT_SETTINGS);
	});

	it('should trigger import if connector plugin is valid', async () => {
		(app as any).plugins.getPlugin.mockReturnValue(mockConnectorPlugin);

		await service.triggerZoteroIntegrationImport('citation-key');

		expect(mockConnectorPlugin.runImport).toHaveBeenCalledWith('Markdown', 'citation-key');
		expect(Notice).toHaveBeenCalledWith("Triggered Zotero Integration Import");
	});

	it('should show error notice if connector plugin is missing', async () => {
		(app as any).plugins.getPlugin.mockReturnValue(null);

		await service.triggerZoteroIntegrationImport('citation-key');

		expect(Notice).toHaveBeenCalledWith(expect.stringContaining("not found"));
	});
});
