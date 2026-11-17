import { ZoteroConnectorService } from '../../../src/services/zotero-connector';
import {
	DEFAULT_SETTINGS,
	DEFAULT_ZOTERO_TEMPLATE,
	MyPluginSettings,
} from '../../../src/types';
import { resetObsidianMocks } from '../../__mocks__/obsidian';
import { createTestApp, getNoticeMessages, TestAppHarness } from '../../fixtures/vault';

describe('ZoteroConnectorService', () => {
	let harness: TestAppHarness;
	let settings: MyPluginSettings;
	let connector: ZoteroConnectorService;

	beforeEach(() => {
		resetObsidianMocks();
		harness = createTestApp();
		settings = {
			...DEFAULT_SETTINGS,
			zoteroTemplate: {
				vaultPath: '',
				content: '',
			},
		};
		connector = new ZoteroConnectorService(harness.app, settings);
	});

	describe('triggerZoteroIntegrationImport', () => {
		it('invokes runImport on obsidian-zotero-desktop-connector when configured', async () => {
			const runImport = jest.fn(async () => undefined);
			harness.registerPlugin('obsidian-zotero-desktop-connector', {
				settings: { exportFormats: [{ name: 'Markdown' }] },
				runImport,
			});

			await connector.triggerZoteroIntegrationImport('smith2024');

			expect(runImport).toHaveBeenCalledWith('Markdown', 'smith2024');
			expect(getNoticeMessages()).toContain(
				'Triggered Zotero Integration Import'
			);
		});

		it('shows notice when connector plugin is missing or non-object', async () => {
			await connector.triggerZoteroIntegrationImport('smith2024');
			expect(getNoticeMessages()).toContain(
				'Obsidian Zotero Desktop Connector plugin not found or configured.'
			);

			harness.registerPlugin('obsidian-zotero-desktop-connector', 'invalid');
			await connector.triggerZoteroIntegrationImport('smith2024');
			expect(getNoticeMessages()).toHaveLength(2);
		});
	});

	describe('triggerInteractiveImport', () => {
		it('executes exact zdc-exp-<format> command when registered', async () => {
			const runImport = jest.fn(async () => undefined);
			harness.registerPlugin('obsidian-zotero-desktop-connector', {
				settings: { exportFormats: [{ name: 'Literature' }] },
				runImport,
			});
			harness.registerCommand('obsidian-zotero-desktop-connector:zdc-exp-Other');
			harness.registerCommand(
				'obsidian-zotero-desktop-connector:zdc-exp-Literature'
			);

			await expect(connector.triggerInteractiveImport()).resolves.toBe(true);
			expect(harness.mockApp.commands.executeCommandById).toHaveBeenCalledWith(
				'obsidian-zotero-desktop-connector:zdc-exp-Literature'
			);
			expect(runImport).not.toHaveBeenCalled();
		});

		it('falls back to first zdc-exp-* command when exact format command is absent', async () => {
			const runImport = jest.fn(async () => undefined);
			harness.registerPlugin('obsidian-zotero-desktop-connector', {
				settings: { exportFormats: [{ name: 'RenamedFormat' }] },
				runImport,
			});
			harness.registerCommand('editor:toggle-bold');
			harness.registerCommand(
				'obsidian-zotero-desktop-connector:zdc-exp-Default'
			);

			await expect(connector.triggerInteractiveImport()).resolves.toBe(true);
			expect(harness.mockApp.commands.executeCommandById).toHaveBeenCalledWith(
				'obsidian-zotero-desktop-connector:zdc-exp-Default'
			);
			expect(runImport).not.toHaveBeenCalled();
		});

		it('falls back to plugin.runImport(fmt.name) when no zdc-exp command exists, or shows Notice when missing', async () => {
			const runImport = jest.fn(async () => undefined);
			harness.registerPlugin('obsidian-zotero-desktop-connector', {
				settings: { exportFormats: [{ name: 'Markdown' }] },
				runImport,
			});
			harness.registerCommand('editor:open-search');

			await expect(connector.triggerInteractiveImport()).resolves.toBe(true);
			expect(runImport).toHaveBeenCalledWith('Markdown');

			// Missing plugin and no zdc-exp commands
			harness.registerPlugin('obsidian-zotero-desktop-connector', null);
			harness.mockApp.commands.commands = {};
			await expect(connector.triggerInteractiveImport()).resolves.toBe(false);
			expect(getNoticeMessages()).toContain(
				'Obsidian Zotero Desktop Connector plugin not found or configured.'
			);
		});
	});

	describe('template path detection, loading, and saving', () => {
		it('detects templatePath or templateFile from connector export format', () => {
			expect(connector.detectTemplatePath()).toBeNull();

			harness.registerPlugin('obsidian-zotero-desktop-connector', {
				settings: {
					exportFormats: [{ templatePath: '000-Templates\\Zotero.md' }],
				},
			});
			expect(connector.detectTemplatePath()).toBe('000-Templates/Zotero.md');

			harness.registerPlugin('obsidian-zotero-desktop-connector', {
				settings: {
					exportFormats: [{ templateFile: '  000-Templates/Alt.njk  ' }],
				},
			});
			expect(connector.detectTemplatePath()).toBe('000-Templates/Alt.njk');

			harness.registerPlugin('obsidian-zotero-desktop-connector', {
				settings: { exportFormats: [{ templatePath: '   ' }] },
			});
			expect(connector.detectTemplatePath()).toBeNull();
		});

		it('loads template from Vault when file exists and falls back to DEFAULT_ZOTERO_TEMPLATE otherwise', async () => {
			expect(await connector.loadTemplateContent()).toEqual({
				path: null,
				content: DEFAULT_ZOTERO_TEMPLATE,
				fromVault: false,
			});

			harness.addFile('000-Templates/Zotero.md', 'Custom Nunjucks {{citekey}}');
			expect(
				await connector.loadTemplateContent('000-Templates/Zotero.md')
			).toEqual({
				path: '000-Templates/Zotero.md',
				content: 'Custom Nunjucks {{citekey}}',
				fromVault: true,
			});

			expect(
				await connector.loadTemplateContent('000-Templates/Missing.md')
			).toEqual({
				path: '000-Templates/Missing.md',
				content: DEFAULT_ZOTERO_TEMPLATE,
				fromVault: false,
			});
		});

		it('validates non-empty path, appends .md when missing, creates parent folders, and creates or modifies Vault file', async () => {
			await expect(connector.saveTemplateToVault('   ', 'body')).rejects.toThrow(
				'Template vault path cannot be empty.'
			);

			const createdPath = await connector.saveTemplateToVault(
				'000-Templates/Sub/ZoteroNote',
				'v1 content'
			);
			expect(createdPath).toBe('000-Templates/Sub/ZoteroNote.md');
			expect(harness.getContent('000-Templates/Sub/ZoteroNote.md')).toBe(
				'v1 content'
			);

			const modifiedPath = await connector.saveTemplateToVault(
				'000-Templates/Sub/ZoteroNote.md',
				'v2 content'
			);
			expect(modifiedPath).toBe('000-Templates/Sub/ZoteroNote.md');
			expect(harness.getContent('000-Templates/Sub/ZoteroNote.md')).toBe(
				'v2 content'
			);
		});
	});
});
