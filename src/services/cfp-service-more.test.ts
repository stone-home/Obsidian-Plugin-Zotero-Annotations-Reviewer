import { App, TFile } from 'obsidian';
import { CFPService } from './cfp';
import type { CFPItem } from '../types';
import { fetchWikiCFP } from './cfp-wikicfp';
import { fetchCcfddl } from './cfp-ccfddl';
import { fetchEasychair } from './cfp-easychair';
import { fetchOpenresearch } from './cfp-openresearch';
import { fetchWikiCFPSeriesIndex, fetchSeriesEvents } from './cfp-wikicfp-series';

jest.mock('./cfp-wikicfp', () => ({ fetchWikiCFP: jest.fn() }));
jest.mock('./cfp-ccfddl', () => ({ fetchCcfddl: jest.fn() }));
jest.mock('./cfp-easychair', () => ({ fetchEasychair: jest.fn() }));
jest.mock('./cfp-openresearch', () => ({ fetchOpenresearch: jest.fn() }));
jest.mock('./cfp-wikicfp-series', () => ({
	fetchWikiCFPSeriesIndex: jest.fn(),
	fetchSeriesEvents: jest.fn()
}));

describe('CFPService additional coverage', () => {
	let app: App;
	let saveSettings: jest.Mock;
	let settings: any;
	let service: CFPService;

	beforeEach(() => {
		app = new App();
		saveSettings = jest.fn().mockResolvedValue(undefined);
		settings = {
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
		};
		service = new CFPService(app, () => settings, saveSettings);

		// Prepare vault helpers used by internals
		(app.vault as any).create = jest.fn().mockResolvedValue(undefined);
		(app.vault as any).getAbstractFileByPath = jest.fn().mockReturnValue(null);
	});

	it('shouldSeriesRefresh uses series-specific timestamps', async () => {
		// lastSeriesFetchTime = 0 → should refresh
		expect(service.shouldSeriesRefresh()).toBe(true);

		settings.cfpLastSeriesFetchTime = Date.now();
		settings.cfpSeriesRefreshDays = 10;
		expect(service.shouldSeriesRefresh()).toBe(false);

		settings.cfpLastSeriesFetchTime = Date.now() - 11 * 24 * 60 * 60 * 1000;
		expect(service.shouldSeriesRefresh()).toBe(true);

		// setLastSeriesFetchTime / getLastSeriesFetchTime round-trip
		settings.cfpLastSeriesFetchTime = 0;
		expect(service.getLastSeriesFetchTime()).toBe(0);
		await service.setLastSeriesFetchTime(42);
		expect(settings.cfpLastSeriesFetchTime).toBe(42);
		expect(saveSettings).toHaveBeenCalled();
	});

	it('getSeriesMap / saveSeriesMap / updateSeriesLastUpdate behave correctly', async () => {
		settings.cfpSeriesMap = {
			CONF: { programUrl: 'http://p', lastUpdate: 0 }
		};

		const map = service.getSeriesMap();
		expect(map).toEqual({ CONF: { programUrl: 'http://p', lastUpdate: 0 } });

		await service.saveSeriesMap({ CONF: { programUrl: 'http://p2', lastUpdate: 5 } });
		expect(settings.cfpSeriesMap.CONF.programUrl).toBe('http://p2');
		expect(saveSettings).toHaveBeenCalled();

		const before = settings.cfpSeriesMap.CONF.lastUpdate;
		await service.updateSeriesLastUpdate('CONF');
		expect(settings.cfpSeriesMap.CONF.lastUpdate).toBeGreaterThan(before);

		// Unknown key should be a no-op
		await service.updateSeriesLastUpdate('UNKNOWN');
	});

	it('refresh*Urls helpers call the correct fetchers and syncToNotes', async () => {
		const baseItem: CFPItem = {
			acronym: 'CONF 2026',
			fullName: 'Conf 2026',
			location: 'Somewhere',
			submissionDdl: '2026-02-01',
			source: 'wikicfp',
			series: 'CONF',
			url: 'u'
		};
		(fetchWikiCFP as jest.Mock).mockResolvedValue([baseItem]);
		(fetchCcfddl as jest.Mock).mockResolvedValue([baseItem]);
		(fetchEasychair as jest.Mock).mockResolvedValue([baseItem]);
		(fetchOpenresearch as jest.Mock).mockResolvedValue([baseItem]);

		settings.cfpWikicfpUrls = ['a'];
		settings.cfpCcfddlUrls = ['b'];
		settings.cfpEasychairUrls = ['c'];
		settings.cfpOpenresearchUrls = ['d'];

		const syncSpy = jest.spyOn<any, any>(service as any, 'syncToNotes').mockResolvedValue(1);

		await service.refreshWikiCFPUrls();
		expect(fetchWikiCFP).toHaveBeenCalledWith(['a']);

		await service.refreshCcfddlUrls();
		expect(fetchCcfddl).toHaveBeenCalledWith(['b']);

		await service.refreshEasychairUrls();
		expect(fetchEasychair).toHaveBeenCalledWith(['c']);

		await service.refreshOpenresearchUrls();
		expect(fetchOpenresearch).toHaveBeenCalledWith(['d']);

		expect(syncSpy).toHaveBeenCalled();
	});

	it('refreshWikiCFPSeries respects selected letters and updates map', async () => {
		settings.cfpSeriesIndexLetters = ['C'];
		(fetchWikiCFPSeriesIndex as jest.Mock).mockResolvedValue([
			{ id: '1', seriesAcronym: 'CONF', fullName: 'Conf', programUrl: 'http://program' }
		]);

		const ensureSeriesNoteSpy = jest
			.spyOn<any, any>(service as any, 'ensureSeriesNote')
			.mockResolvedValue(undefined);

		await service.refreshWikiCFPSeries();

		expect(fetchWikiCFPSeriesIndex).toHaveBeenCalledWith(expect.any(Function), ['C']);
		expect(ensureSeriesNoteSpy).toHaveBeenCalledWith(
			expect.stringContaining('CFP/CONF'),
			'CONF',
			expect.any(Array),
			'http://program'
		);
		expect(settings.cfpSeriesMap.CONF.programUrl).toBe('http://program');
		expect(settings.cfpLastSeriesFetchTime).toBeGreaterThan(0);
	});

	it('runDailySeriesRefresh schedules refresh for oldest series only once per day', async () => {
		jest.useFakeTimers();
		const timeoutSpy = jest.spyOn(global, 'setTimeout');

		settings.cfpSeriesMap = {
			CONF: { programUrl: 'http://p1', lastUpdate: 0 },
			CONF2: { programUrl: 'http://p2', lastUpdate: 100 }
		};

		const refreshSpy = jest
			.spyOn<any, any>(service as any, 'refreshSeriesByUrl')
			.mockResolvedValue(undefined);

		await service.runDailySeriesRefresh();

		expect(settings.cfpLastDailyRun).toBeGreaterThan(0);
		// Timers are scheduled but not executed yet.
		expect(timeoutSpy).toHaveBeenCalled();

		// Execute scheduled callbacks.
		jest.runOnlyPendingTimers();
		expect(refreshSpy).toHaveBeenCalled();

		const lastRun = settings.cfpLastDailyRun;
		// Second call within the same day should be a no-op.
		await service.runDailySeriesRefresh();
		expect(settings.cfpLastDailyRun).toBe(lastRun);

		timeoutSpy.mockRestore();
		jest.useRealTimers();
	});

	it('getCFPNotesForDisplay partitions upcoming and past based on submission_ddl', async () => {
		const fileUpcoming = new TFile() as any;
		fileUpcoming.path = 'CFP/CONF/CONF 2999.md';
		const filePast = new TFile() as any;
		filePast.path = 'CFP/CONF/CONF 2000.md';
		const fileSeries = new TFile() as any;
		fileSeries.path = 'CFP/CONF/CONF Series.md';

		(app.vault.getMarkdownFiles as jest.Mock).mockReturnValue([
			fileUpcoming,
			filePast,
			fileSeries
		]);

		(app.metadataCache.getFileCache as jest.Mock).mockImplementation((file: any) => {
			if (file === fileSeries) {
				return { frontmatter: { 'cfp-series': true } };
			}
			if (file === fileUpcoming) {
				return {
					frontmatter: {
						acronym: 'CONF 2999',
						'full-name': 'Future Conf',
						location: 'Future City',
						start: '2999-01-01',
						end: '2999-01-03',
						'submission_ddl': '2998-12-01',
						'cfp-source': 'wikicfp',
						url: 'u1'
					}
				};
			}
			if (file === filePast) {
				return {
					frontmatter: {
						acronym: 'CONF 2000',
						'full-name': 'Past Conf',
						location: 'Past City',
						start: '2000-01-01',
						end: '2000-01-03',
						'submission_ddl': '2000-01-01',
						'cfp-source': 'wikicfp',
						url: 'u2'
					}
				};
			}
			return null;
		});

		const { upcoming, past } = await service.getCFPNotesForDisplay();

		expect(upcoming).toHaveLength(1);
		expect(upcoming[0].item.acronym).toBe('CONF 2999');
		expect(past).toHaveLength(1);
		expect(past[0].item.acronym).toBe('CONF 2000');
	});
});

