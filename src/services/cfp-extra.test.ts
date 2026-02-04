import { App } from 'obsidian';
import { CFPService } from './cfp';
import type { CFPItem } from '../types';
import { fetchWikiCFP } from './cfp-wikicfp';
import { fetchCcfddl } from './cfp-ccfddl';
import { fetchEasychair } from './cfp-easychair';
import { fetchOpenresearch } from './cfp-openresearch';
import { fetchSeriesEvents } from './cfp-wikicfp-series';

jest.mock('./cfp-wikicfp', () => ({ fetchWikiCFP: jest.fn() }));
jest.mock('./cfp-ccfddl', () => ({ fetchCcfddl: jest.fn() }));
jest.mock('./cfp-easychair', () => ({ fetchEasychair: jest.fn() }));
jest.mock('./cfp-openresearch', () => ({ fetchOpenresearch: jest.fn() }));
jest.mock('./cfp-wikicfp-series', () => ({
	fetchSeriesEvents: jest.fn(),
	fetchWikiCFPSeriesIndex: jest.fn()
}));

describe('CFPService high-level behaviour', () => {
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
			cfpWikicfpUrls: ['https://wikicfp.com'],
			cfpCcfddlUrls: ['https://ccfddl.com/all.yml'],
			cfpEasychairUrls: ['https://easychair.org'],
			cfpOpenresearchUrls: ['https://openresearch.org']
		};
		service = new CFPService(app, () => settings, saveSettings);

		// Provide create so createOrOverwriteFile can succeed
		(app.vault as any).create = jest.fn().mockResolvedValue(undefined);
		(app.vault as any).getAbstractFileByPath = jest.fn().mockReturnValue(null);
	});

	it('fetchAll merges sources and deduplicates by acronym', async () => {
		const baseItem = (overrides: Partial<CFPItem>): CFPItem => ({
			acronym: 'CONF 2026',
			fullName: 'Conf 2026',
			location: 'Somewhere',
			submissionDdl: '2026-02-01',
			source: 'wikicfp',
			series: 'CONF',
			url: 'u',
			...overrides
		});

		(fetchWikiCFP as jest.Mock).mockResolvedValue([baseItem({ source: 'wikicfp' })]);
		(fetchCcfddl as jest.Mock).mockResolvedValue([baseItem({ source: 'ccfddl' })]);
		(fetchEasychair as jest.Mock).mockResolvedValue([baseItem({ acronym: 'EC 2026', source: 'easychair' })]);
		(fetchOpenresearch as jest.Mock).mockResolvedValue([]);

		const items = await service.fetchAll();

		// One of the duplicate "CONF 2026" items should be removed.
		expect(items.map(i => i.acronym)).toEqual(['CONF 2026', 'EC 2026']);
		expect(fetchWikiCFP).toHaveBeenCalled();
		expect(fetchCcfddl).toHaveBeenCalled();
		expect(fetchEasychair).toHaveBeenCalled();
	});

	it('saveManualCFP writes normalised date strings into frontmatter', async () => {
		const item: CFPItem = {
			acronym: 'WAIFI 2016',
			series: 'WAIFI',
			fullName: 'International Workshop on the Arithmetic of Finite Fields 2016',
			location: 'Ghent University, Ghent, Belgium',
			start: 'Jul 13, 2016',
			end: 'Jul 15, 2016',
			submissionDdl: 'May 1, 2016',
			source: 'wikicfp',
			url: 'http://example.com'
		};

		await service.saveManualCFP(item);

		expect((app.vault as any).create).toHaveBeenCalled();
		// Find the call that created the actual event note (path includes the acronym).
		const createCalls = (app.vault as any).create.mock.calls as [string, string][];
		const [, content] =
			createCalls.find(([path]) => path.includes('WAIFI 2016')) ??
			createCalls[createCalls.length - 1];
		expect(content).toContain('submission_ddl: "2016-05-01"');
		expect(content).toContain('start: "2016-07-13"');
		expect(content).toContain('end: "2016-07-15"');
	});

	it('refreshSeriesByUrl fetches events and syncs notes', async () => {
		const events: CFPItem[] = [
			{
				acronym: 'CONF 2026',
				series: 'CONF',
				fullName: 'Conf 2026',
				location: 'X',
				start: '2026-06-01',
				end: '2026-06-03',
				submissionDdl: '2026-02-01',
				source: 'wikicfp',
				url: 'u'
			}
		];
		(fetchSeriesEvents as jest.Mock).mockResolvedValue(events);

		// Spy on syncToNotes to ensure it is invoked with the events returned.
		const syncSpy = jest.spyOn<any, any>(service as any, 'syncToNotes');
		syncSpy.mockResolvedValue(1);

		await service.refreshSeriesByUrl('http://program', 'CONF');

		expect(fetchSeriesEvents).toHaveBeenCalledWith('http://program', 'CONF', undefined);
		expect(syncSpy).toHaveBeenCalledWith(events);
		expect(settings.cfpSeriesMap.CONF.programUrl).toBe('http://program');
	});
});

