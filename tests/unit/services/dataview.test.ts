import { Component } from 'obsidian';
import { DataviewApi, DataviewService } from '../../../src/services/dataview';
import { createTestApp } from '../../fixtures/vault';

describe('DataviewService', () => {
	let mockExecuteJs: jest.Mock<
		Promise<void> | void,
		[string, HTMLElement, Component, string]
	>;
	let mockApi: DataviewApi;

	beforeEach(() => {
		mockExecuteJs = jest.fn<
			Promise<void> | void,
			[string, HTMLElement, Component, string]
		>(async () => undefined);
		mockApi = {
			executeJs: mockExecuteJs,
		};
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('detects when Dataview plugin is installed with settings and api', () => {
		const { app, registerPlugin } = createTestApp();
		registerPlugin('dataview', { settings: { enableJs: true }, api: mockApi });
		const service = new DataviewService(app);

		expect(service.isAvailable).toBe(true);
		expect(service.api).toBe(mockApi);
	});

	it('returns unavailable when plugins container, plugin instance, or plugin.settings is missing', () => {
		const { app, mockApp, registerPlugin } = createTestApp();
		const service = new DataviewService(app);

		// Missing plugin entry
		expect(service.isAvailable).toBe(false);
		expect(service.api).toBeUndefined();

		// Non-object plugin return value
		registerPlugin('dataview', 'not-an-object');
		expect(service.isAvailable).toBe(false);

		// Plugin object without settings (not yet initialized)
		registerPlugin('dataview', { api: mockApi });
		expect(service.isAvailable).toBe(false);
		expect(service.api).toBeUndefined();

		// App without plugins container at all
		const bareApp = Object.assign(Object.create(Object.getPrototypeOf(mockApp)), {
			...mockApp,
			plugins: undefined,
		});
		const bareService = new DataviewService(bareApp);
		expect(bareService.isAvailable).toBe(false);
	});

	it('executes script with default empty input and with custom JSON params', async () => {
		const { app, registerPlugin } = createTestApp();
		registerPlugin('dataview', { settings: {}, api: mockApi });
		const service = new DataviewService(app);
		const container = document.createElement('div');
		const component = new Component();

		await service.executeScript('dv.paragraph("hi")', container, component, 'a.md');
		expect(mockExecuteJs).toHaveBeenCalledWith(
			'const input = {};\n\ndv.paragraph("hi")',
			container,
			component,
			'a.md'
		);

		await service.executeScript(
			'console.log(input.foo)',
			container,
			component,
			'path/to/file.md',
			{ foo: 'bar', count: 2 }
		);
		expect(mockExecuteJs).toHaveBeenLastCalledWith(
			'const input = {"foo":"bar","count":2};\n\nconsole.log(input.foo)',
			container,
			component,
			'path/to/file.md'
		);
	});

	it('renders fallback notice into container when Dataview API is unavailable', async () => {
		const { app } = createTestApp();
		const service = new DataviewService(app);
		const container = document.createElement('div');
		const component = new Component();

		await service.executeScript('code', container, component, 'path.md', {});
		expect(container.textContent).toBe('Dataview API not available.');
	});

	it('catches script execution errors and renders error message into container', async () => {
		const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		const { app, registerPlugin } = createTestApp();
		mockExecuteJs.mockRejectedValueOnce(new Error('Syntax error'));
		registerPlugin('dataview', { settings: {}, api: mockApi });
		const service = new DataviewService(app);
		const container = document.createElement('div');
		const component = new Component();

		await service.executeScript('bad code', container, component, 'path.md', {});
		expect(errorSpy).toHaveBeenCalledTimes(1);
		const errDiv = container.querySelector('.zotero-text-error');
		expect(errDiv?.textContent).toContain('Script Error: Syntax error');
	});
});
