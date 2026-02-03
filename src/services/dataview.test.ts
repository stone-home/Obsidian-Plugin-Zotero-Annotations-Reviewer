import { DataviewService } from './dataview';
import { App, Component } from 'obsidian';

describe('DataviewService', () => {
	let app: App;
	let service: DataviewService;
	let mockApi: any;

	beforeEach(() => {
		app = new App();
		mockApi = { executeJs: jest.fn() };

		// Mock the plugin container
		(app as any).plugins = {
			getPlugin: jest.fn()
		};

		service = new DataviewService(app);
	});

	it('should detect when dataview is available', () => {
		// Setup: Dataview is present
		(app as any).plugins.getPlugin.mockReturnValue({ settings: {}, api: mockApi });

		expect(service.isAvailable).toBe(true);
		expect(service.api).toBe(mockApi);
	});

	it('should detect when dataview is missing', () => {
		(app as any).plugins.getPlugin.mockReturnValue(null);
		expect(service.isAvailable).toBe(false);
	});

	it('should execute script with injected params', async () => {
		// Setup available
		(app as any).plugins.getPlugin.mockReturnValue({ settings: {}, api: mockApi });

		const container = document.createElement('div');
		const component = new Component();
		const code = 'console.log("hello")';
		const params = { foo: 'bar' };

		await service.executeScript(code, container, component, 'path/to/file', params);

		expect(mockApi.executeJs).toHaveBeenCalledWith(
			expect.stringContaining('const input = {"foo":"bar"};\n\nconsole.log("hello")'),
			container,
			component,
			'path/to/file'
		);
	});

	it('should show message when Dataview API is not available', async () => {
		(app as any).plugins.getPlugin.mockReturnValue(null);
		service = new DataviewService(app);
		const container = document.createElement('div') as HTMLElement & { createDiv: (opts?: { text?: string }) => HTMLElement };
		container.createDiv = jest.fn((opts?: { text?: string }) => {
			const div = document.createElement('div');
			if (opts?.text) div.textContent = opts.text;
			return div;
		});
		const component = new Component();
		await service.executeScript('code', container, component, 'path', {});
		expect(container.createDiv).toHaveBeenCalledWith({ text: 'Dataview API not available.' });
	});

	it('should show script error in container when executeJs throws', async () => {
		jest.spyOn(console, 'error').mockImplementation(() => {});
		(app as any).plugins.getPlugin.mockReturnValue({ settings: {}, api: mockApi });
		service = new DataviewService(app);
		mockApi.executeJs.mockRejectedValue(new Error('Syntax error'));
		const container = document.createElement('div') as HTMLElement & { createDiv: (opts?: { text?: string; cls?: string }) => HTMLElement };
		container.createDiv = jest.fn((opts?: { text?: string; cls?: string }) => {
			const div = document.createElement('div');
			if (opts?.text) div.textContent = opts.text;
			return div;
		});
		const component = new Component();
		await service.executeScript('bad code', container, component, 'path', {});
		expect(container.createDiv).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('Script Error') }));
		jest.restoreAllMocks();
	});
});
