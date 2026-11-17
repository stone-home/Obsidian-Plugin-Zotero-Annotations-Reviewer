import ZoteroGKPlugin from '../../src/main';
import {
	DEFAULT_PAPER_WORKSPACE,
	DEFAULT_PROMPTS,
	DEFAULT_ZOTERO_TEMPLATE,
	MyPluginSettings,
} from '../../src/types';
import { CFPListModal } from '../../src/ui/cfp-list-modal';
import { CFPManualModal } from '../../src/ui/cfp-manual-modal';
import { HighlightModal } from '../../src/ui/highlights';
import { WebhookSelectionModal } from '../../src/ui/webhook-modals';
import {
	Plugin as MockPlugin,
	request,
	requestUrl,
	resetObsidianMocks,
} from '../__mocks__/obsidian';
import {
	clearNotices,
	clearOpenedModals,
	createTestApp,
	getLastOpenedModal,
	getNoticeMessages,
	TestAppHarness,
} from '../fixtures/vault';

async function flushAsync(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ZoteroGKPlugin integration lifecycle', () => {
	let harness: TestAppHarness;
	let logSpy: jest.SpyInstance;
	let warnSpy: jest.SpyInstance;
	let errorSpy: jest.SpyInstance;

	beforeEach(() => {
		resetObsidianMocks();
		harness = createTestApp();
		logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
		warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
		errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		request.mockResolvedValue(JSON.stringify({ result: [] }));
		requestUrl.mockResolvedValue({
			status: 200,
			headers: {},
			text: '<html></html>',
			json: {},
			arrayBuffer: new ArrayBuffer(0),
		});
	});

	afterEach(() => {
		logSpy.mockRestore();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
		const win = window as unknown as {
			__ZoteroAnnotationReviewerCFP?: unknown;
		};
		delete win.__ZoteroAnnotationReviewerCFP;
	});

	describe('loadSettings migrations and upgrade safety', () => {
		it('initializes clean defaults when stored data is null', async () => {
			const plugin = new ZoteroGKPlugin(harness.app, harness.manifest);
			plugin.loadData = jest.fn(async () => null);

			await plugin.loadSettings();

			expect(plugin.settings.paperWorkspace).toEqual(DEFAULT_PAPER_WORKSPACE);
			expect(plugin.settings.zoteroTemplate).toEqual({
				vaultPath: '900-Templates/zotero-note-template.md',
				content: DEFAULT_ZOTERO_TEMPLATE,
			});
			expect(plugin.settings.prompts.map((p) => p.id)).toEqual(
				DEFAULT_PROMPTS.map((p) => p.id)
			);
			expect(plugin.settings.enableLegacyAssistantScript).toBe(false);
		});

		it('migrates legacy fleetingNoteFolder, strips s3Prefix, repairs blank labels/paths, preserves customized/custom prompts, and backfills CFP fields', async () => {
			const plugin = new ZoteroGKPlugin(harness.app, harness.manifest);
			const legacyData: Record<string, unknown> = {
				fleetingNoteFolder: 'Legacy-Fleeting',
				paperWorkspace: {
					templatesFolder: '   ',
					report1Label: '',
					report2Label: '   ',
					takeawayLabel: '',
					s3Prefix: 's3://obsolete-bucket/papers',
				},
				zoteroTemplate: {
					vaultPath: '   ',
					content: '',
				},
				prompts: [
					{
						id: 'synthesize',
						name: 'My Custom Synthesize',
						vaultPath: '900-Templates/prompt-synthesize.md',
						content: '# User Customized Synthesize',
					},
					{
						id: 'user_audit',
						name: 'User Audit',
						vaultPath: '900-Templates/prompt-user_audit.md',
						content: '# Audit Prompt',
						builtIn: false,
					},
				],
				enableLegacyAssistantScript: 'invalid-string',
				cfpDefaultTags: 'not-an-array',
				cfpWikicfpUrls: null,
				cfpEasychairUrls: null,
				cfpCcfddlUrls: null,
				cfpOpenresearchUrls: null,
				cfpRefreshDays: 'bad',
				cfpLastFetchTime: 'bad',
				cfpSeriesRefreshDays: 'bad',
				cfpLastSeriesFetchTime: 'bad',
				cfpNoteDir: 123,
				cfpSeriesMap: null,
				cfpLastDailyRun: 'bad',
				cfpSeriesIndexLetters: 'bad',
				cfpSeriesDataviewJSCode: null,
				cfpAcronymKey: null,
				cfpCoreCsvPath: null,
				cfpCcfddlLocalPath: null,
			};
			plugin.loadData = jest.fn(async () => legacyData);

			await plugin.loadSettings();

			expect(plugin.settings.paperWorkspace.highlightNotesFolder).toBe(
				'Legacy-Fleeting'
			);
			expect(plugin.settings.paperWorkspace.templatesFolder).toBe(
				'900-Templates'
			);
			expect(plugin.settings.paperWorkspace.report1Label).toBe('Deep Report');
			expect(plugin.settings.paperWorkspace.report2Label).toBe('External Report');
			expect(plugin.settings.paperWorkspace.takeawayLabel).toBe('Takeaway');
			expect(
				's3Prefix' in
					(plugin.settings.paperWorkspace as unknown as Record<
						string,
						unknown
					>)
			).toBe(false);

			expect(plugin.settings.zoteroTemplate).toEqual({
				vaultPath: '900-Templates/zotero-note-template.md',
				content: DEFAULT_ZOTERO_TEMPLATE,
			});

			// Preserved user-customized 'synthesize', added missing built-ins, and kept custom 'user_audit'
			const synth = plugin.settings.prompts.find((p) => p.id === 'synthesize')!;
			expect(synth.content).toBe('# User Customized Synthesize');
			expect(synth.kind).toBe('prompt');
			expect(synth.builtIn).toBe(true);

			expect(plugin.settings.prompts.some((p) => p.id === 'tpl-core-note')).toBe(
				true
			);
			const custom = plugin.settings.prompts.find((p) => p.id === 'user_audit')!;
			expect(custom.content).toBe('# Audit Prompt');
			expect(custom.kind).toBe('prompt');

			expect(plugin.settings.enableLegacyAssistantScript).toBe(false);
			expect(plugin.settings.cfpDefaultTags).toEqual(['cfp']);
			expect(plugin.settings.cfpRefreshDays).toBe(5);
			expect(plugin.settings.cfpSeriesRefreshDays).toBe(30);
			expect(plugin.settings.cfpNoteDir).toBe('CFP');
			expect(plugin.settings.cfpSeriesMap).toEqual({});
			expect(plugin.settings.cfpSeriesIndexLetters).toEqual([]);
		});
	});

	describe('onload, code block processors, commands, ribbon, window API, and onunload', () => {
		it('registers processors/commands/views, materializes templates on layout ready, handles startup CFP refresh warnings, and cleans up on unload', async () => {
			const plugin = new ZoteroGKPlugin(harness.app, harness.manifest);
			harness.attachPluginViews(plugin);

			const savedPayloads: MyPluginSettings[] = [];
			plugin.loadData = jest.fn(async () => ({
				cfpRefreshDays: 0,
				cfpSeriesRefreshDays: 0,
				webhookShowInRibbon: true,
				webhooks: [
					{
						id: 'wh-int',
						name: 'Integration Hook',
						icon: 'send',
						url: 'https://hooks.example.com/int',
						method: 'POST',
						contentType: 'json',
						headers: [],
						bodyTemplate: '{"key":"{{citekey}}"}',
						hidden: false,
					},
				],
			}));
			plugin.saveData = jest.fn(async (data: unknown) => {
				savedPayloads.push(data as MyPluginSettings);
			});

			await plugin.onload();
			await flushAsync();

			const mockPlugin = plugin as unknown as MockPlugin;

			// 1. Verify code block processors (zotero-assistant, project-picker, cfp-list)
			expect(Array.from(mockPlugin.codeBlockProcessors.keys())).toEqual(
				expect.arrayContaining([
					'zotero-assistant',
					'project-picker',
					'cfp-list',
				])
			);

			const litNote = harness.addFile('002-Literature/int2026.md', '', {
				'citation-key': 'int2026',
				title: 'Integration Paper',
				projects: ['[[Proj1]]'],
			});
			harness.setActiveFile(litNote);

			const assistantEl = document.createElement('div');
			mockPlugin.codeBlockProcessors.get('zotero-assistant')!(
				'',
				assistantEl,
				harness.createPostProcessorContext(litNote.path)
			);
			await flushAsync();
			expect(assistantEl.textContent).toContain('Core Note');

			const pickerEl = document.createElement('div');
			mockPlugin.codeBlockProcessors.get('project-picker')!(
				'',
				pickerEl,
				harness.createPostProcessorContext(litNote.path)
			);
			expect(pickerEl.textContent).toContain('Linked Projects:');

			const cfpEl = document.createElement('div');
			mockPlugin.codeBlockProcessors.get('cfp-list')!(
				'',
				cfpEl,
				harness.createPostProcessorContext(litNote.path)
			);
			await flushAsync();
			expect(cfpEl.textContent).toContain('Next deadlines');

			// 2. Layout ready materializes all 9 built-in template & prompt files
			await harness.triggerLayoutReady();
			await flushAsync();
			expect(
				harness.getFile('900-Templates/zotero-note-template.md')
			).not.toBeNull();
			expect(
				harness.getFile('900-Templates/prompt-synthesize.md')
			).not.toBeNull();

			// 3. Commands: zotero-trigger-webhook, cfp-add-manual, cfp-show-list, cfp-refresh-this-series
			const findCmd = (id: string) =>
				mockPlugin.commands.find((c) => c.id === id)!;

			// zotero-trigger-webhook checkCallback
			harness.setActiveFile(null);
			expect(findCmd('zotero-trigger-webhook').checkCallback!(true)).toBe(false);

			harness.setActiveFile(litNote);
			expect(findCmd('zotero-trigger-webhook').checkCallback!(true)).toBe(true);
			clearOpenedModals();
			findCmd('zotero-trigger-webhook').checkCallback!(false);
			const whModal = getLastOpenedModal<WebhookSelectionModal>()!;
			expect(whModal).toBeInstanceOf(WebhookSelectionModal);
			whModal.onChooseSuggestion(plugin.settings.webhooks[0]);
			await flushAsync();
			expect(requestUrl).toHaveBeenCalledWith(
				expect.objectContaining({ url: 'https://hooks.example.com/int' })
			);

			// cfp-add-manual & cfp-show-list
			clearOpenedModals();
			findCmd('cfp-add-manual').callback!();
			const manualModal = getLastOpenedModal<CFPManualModal>()!;
			expect(manualModal).toBeInstanceOf(CFPManualModal);
			manualModal.onSubmit({
				acronym: 'OSDI 2027',
				fullName: 'Operating Systems Design and Implementation',
				location: 'Seattle',
				submissionDdl: '2026-12-01',
				source: 'manual',
			});
			await flushAsync();
			expect(getNoticeMessages()).toContain('CFP note created.');

			clearOpenedModals();
			await findCmd('cfp-show-list').callback!();
			expect(getLastOpenedModal()).toBeInstanceOf(CFPListModal);

			// cfp-refresh-this-series checkCallback
			expect(findCmd('cfp-refresh-this-series').checkCallback!(true)).toBe(false);
			const seriesNote = harness.addFile(
				'CFP/OSDI/OSDI Series.md',
				'# OSDI Series',
				{
					'cfp-series': true,
					'series-url': 'http://www.wikicfp.com/cfp/program?id=2000&s=OSDI',
				}
			);
			harness.setActiveFile(seriesNote);
			expect(findCmd('cfp-refresh-this-series').checkCallback!(true)).toBe(true);
			requestUrl.mockClear();
			findCmd('cfp-refresh-this-series').checkCallback!(false);
			await flushAsync();
			await flushAsync();
			expect(requestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: 'http://www.wikicfp.com/cfp/program?id=2000&s=OSDI',
				})
			);

			// 4. Webhook ribbon icon (no active file vs active file) and removal when toggled off
			const whRibbon = mockPlugin.ribbonIcons.find((r) => r.icon === 'webhook');
			expect(whRibbon).toBeDefined();
			harness.setActiveFile(null);
			clearNotices();
			whRibbon!.el.click();
			expect(getNoticeMessages()).toContain('Open a note first.');

			harness.setActiveFile(litNote);
			clearOpenedModals();
			whRibbon!.el.click();
			expect(getLastOpenedModal()).toBeInstanceOf(WebhookSelectionModal);

			plugin.settings.webhookShowInRibbon = false;
			plugin.updateWebhookRibbonIcon();

			// 5. triggerReviewForActiveFile (with key vs without key)
			clearOpenedModals();
			await plugin.triggerReviewForActiveFile(litNote);
			expect(getLastOpenedModal()).toBeInstanceOf(HighlightModal);

			const unkeyed = harness.addFile('002-Literature/nokey.md', '# None');
			clearNotices();
			await plugin.triggerReviewForActiveFile(unkeyed);
			expect(getNoticeMessages()).toContain('❌ No citation key found.');

			// 6. window.__ZoteroAnnotationReviewerCFP.refreshSeries (success & failure via external boundary) + onunload cleanup
			const win = window as unknown as {
				__ZoteroAnnotationReviewerCFP?: {
					refreshSeries: (url: string, ac: string) => Promise<void>;
				};
			};
			expect(win.__ZoteroAnnotationReviewerCFP).toBeDefined();
			await win.__ZoteroAnnotationReviewerCFP!.refreshSeries(
				'http://www.wikicfp.com/cfp/program?id=1',
				'NSDI'
			);
			expect(getNoticeMessages()).toContain('NSDI events refreshed.');

			plugin.saveData = jest.fn(async () => {
				throw new Error('Disk write failed');
			});
			await win.__ZoteroAnnotationReviewerCFP!.refreshSeries(
				'http://www.wikicfp.com/cfp/program?id=1',
				'NSDI'
			);
			expect(getNoticeMessages()).toContain('Refresh failed. See console.');

			plugin.saveData = jest.fn(async (data: unknown) => {
				savedPayloads.push(data as MyPluginSettings);
			});
			await plugin.saveSettings();
			expect(savedPayloads.length).toBeGreaterThan(0);

			plugin.onunload();
			expect(win.__ZoteroAnnotationReviewerCFP).toBeUndefined();
		});

		it('logs console.warn when background CFP startup refreshes reject instead of swallowing silently', async () => {
			const plugin = new ZoteroGKPlugin(harness.app, harness.manifest);
			plugin.loadData = jest.fn(async () => ({
				cfpRefreshDays: 1,
				cfpLastFetchTime: 0,
				cfpSeriesRefreshDays: 1,
				cfpLastSeriesFetchTime: 0,
				cfpSeriesIndexLetters: ['A'],
				cfpLastDailyRun: 0,
			}));
			// Fail at the Obsidian Plugin.saveData external boundary so all 3 background refreshes reject
			plugin.saveData = jest.fn(async () => {
				throw new Error('Persistence unavailable');
			});

			jest.useFakeTimers();
			await plugin.onload();
			await jest.runAllTimersAsync();
			jest.useRealTimers();
			await flushAsync();

			expect(errorSpy).toHaveBeenCalledWith(
				'[CFP] refresh failed',
				expect.any(Error)
			);
			expect(warnSpy).toHaveBeenCalledWith(
				'[CFP] background refresh failed:',
				expect.any(Error)
			);
			expect(warnSpy).toHaveBeenCalledTimes(2);

			plugin.onunload();
		});
	});
});
