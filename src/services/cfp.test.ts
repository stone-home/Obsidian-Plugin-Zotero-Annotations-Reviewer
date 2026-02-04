import { CFPService, getSeriesRefreshButtonDataviewJS } from './cfp';
import { App } from 'obsidian';

describe('CFPService', () => {
	let app: App;
	let getSettings: () => any;
	let saveSettings: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
		app = new App();
		saveSettings = jest.fn().mockResolvedValue(undefined);
		getSettings = () => ({
			cfpNoteDir: 'CFP',
			cfpDefaultTags: ['cfp'],
			cfpRefreshDays: 5,
			cfpSeriesRefreshDays: 30,
			cfpLastFetchTime: 0,
			cfpLastSeriesFetchTime: 0,
			cfpSeriesMap: {},
			cfpLastDailyRun: 0,
			cfpSeriesIndexLetters: [],
			cfpSeriesDataviewJSCode: '',
			cfpWikicfpUrls: [],
			cfpCcfddlUrls: [],
			cfpEasychairUrls: [],
			cfpOpenresearchUrls: []
		});
	});

	it('shouldRefresh returns true when lastFetchTime is 0', () => {
		const service = new CFPService(app, getSettings, saveSettings);
		expect(service.shouldRefresh()).toBe(true);
	});

	it('shouldRefresh returns false when within refresh interval', () => {
		const s = {
			cfpNoteDir: 'CFP',
			cfpDefaultTags: ['cfp'],
			cfpRefreshDays: 5,
			cfpLastFetchTime: Date.now() - 2 * 24 * 60 * 60 * 1000,
			cfpWikicfpUrls: [] as string[],
			cfpEasychairUrls: [] as string[],
			cfpOpenresearchUrls: [] as string[]
		};
		const service = new CFPService(app, () => s, saveSettings);
		expect(service.shouldRefresh()).toBe(false);
	});

	it('shouldRefresh returns true when past refresh interval', () => {
		const s = {
			cfpNoteDir: 'CFP',
			cfpDefaultTags: ['cfp'],
			cfpRefreshDays: 6,
			cfpLastFetchTime: Date.now() - 7 * 24 * 60 * 60 * 1000,
			cfpWikicfpUrls: [] as string[],
			cfpEasychairUrls: [] as string[],
			cfpOpenresearchUrls: [] as string[]
		};
		const service = new CFPService(app, () => s, saveSettings);
		expect(service.shouldRefresh()).toBe(true);
	});

	it('getLastFetchTime and setLastFetchTime round-trip', async () => {
		const settings = {
			cfpNoteDir: 'CFP',
			cfpDefaultTags: ['cfp'],
			cfpRefreshDays: 5,
			cfpLastFetchTime: 0,
			cfpWikicfpUrls: [] as string[],
			cfpEasychairUrls: [] as string[],
			cfpOpenresearchUrls: [] as string[]
		};
		const service = new CFPService(app, () => settings, saveSettings);
		expect(service.getLastFetchTime()).toBe(0);
		await service.setLastFetchTime(12345);
		expect(settings.cfpLastFetchTime).toBe(12345);
		expect(saveSettings).toHaveBeenCalled();
	});
});

/**
 * Agent: verify DataviewJS button and window API logic.
 * - Button must be created with dv.el (Dataview API).
 * - Parse/fetch must run in plugin via window.__ZoteroAnnotationReviewerCFP.refreshSeries.
 * - Script reads series-url and series name from current page (dv.current()).
 */
describe('CFP Series DataviewJS button and window API', () => {
	it('getSeriesRefreshButtonDataviewJS uses dv.el to create button', () => {
		const script = getSeriesRefreshButtonDataviewJS();
		expect(script).toContain('dv.el("button"');
		expect(script).toContain('Refresh events');
	});

	it('getSeriesRefreshButtonDataviewJS uses settings code when provided', () => {
		const customCode = 'const btn = dv.el("button", "Custom");';
		const settings = { cfpSeriesDataviewJSCode: customCode } as any;
		const script = getSeriesRefreshButtonDataviewJS(settings);
		expect(script).toBe(customCode);
	});

	it('getSeriesRefreshButtonDataviewJS calls plugin via window.__ZoteroAnnotationReviewerCFP', () => {
		const script = getSeriesRefreshButtonDataviewJS();
		expect(script).toContain('window.__ZoteroAnnotationReviewerCFP');
		expect(script).toContain('refreshSeries(programUrl, seriesAcronym)');
	});

	it('getSeriesRefreshButtonDataviewJS reads programUrl and series from current page', () => {
		const script = getSeriesRefreshButtonDataviewJS();
		expect(script).toContain('dv.current()');
		expect(script).toContain('cur["series-url"]');
		expect(script).toContain('programUrl');
		expect(script).toContain('seriesAcronym');
		expect(script).toMatch(/cur\.file\?\.name.*Series/);
	});

	it('getSeriesRefreshButtonDataviewJS guards before rendering and uses addEventListener', () => {
		const script = getSeriesRefreshButtonDataviewJS();
		expect(script).toContain('if (cur && cur["series-url"])');
		expect(script).toContain('addEventListener("click"');
		expect(script).toContain('e.preventDefault()');
	});
});
