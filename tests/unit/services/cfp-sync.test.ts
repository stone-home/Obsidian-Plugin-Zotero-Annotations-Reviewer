import {
	CFPService,
	getSeriesRefreshButtonDataviewJS,
} from '../../../src/services/cfp';
import { parseCcfddlYaml } from '../../../src/services/cfp-ccfddl';
import { CFPItem, DEFAULT_SETTINGS, MyPluginSettings } from '../../../src/types';
import { requestUrl, resetObsidianMocks } from '../../__mocks__/obsidian';
import { createTestApp, getNoticeMessages, TestAppHarness } from '../../fixtures/vault';

function makeHttpResponse(status: number, text: string) {
	return {
		status,
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
		json: null,
		text,
	};
}

const CCF_YAML = [
	'- title: OSDI',
	'  description: Operating Systems Design and Implementation',
	'  sub: SE',
	'  rank:',
	'    ccf: A',
	'    thcpl: B',
	'  confs:',
	'    - year: 2026',
	'      id: osdi26',
	'      link: https://osdi.example.org',
	'      timeline:',
	'        - deadline: "2025-12-01 23:59:59"',
	'      date: July 1-3, 2026',
	'      place: Seattle',
].join('\n');

const CORE_CSV = [
	'1,Operating Systems Design and Implementation,OSDI,ICORE2026,A*,x',
	'2,Foo Conference,FOO,ICORE2023,Unranked,x',
].join('\n');

function makeItem(overrides: Partial<CFPItem> = {}): CFPItem {
	return {
		acronym: 'CONF 2026',
		fullName: 'Conf 2026',
		location: 'Somewhere',
		submissionDdl: 'Feb 1, 2026',
		source: 'wikicfp',
		series: 'CONF',
		url: 'http://conf.example.org',
		...overrides,
	};
}

describe('CFPService synchronization, refresh, ranking, and series management', () => {
	let harness: TestAppHarness;
	let settings: MyPluginSettings;
	let saveSettings: jest.Mock<Promise<void>, []>;
	let service: CFPService;

	beforeEach(() => {
		resetObsidianMocks();
		parseCcfddlYaml('[]');
		jest.spyOn(console, 'log').mockImplementation(() => {});
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		jest.spyOn(console, 'error').mockImplementation(() => {});

		harness = createTestApp();
		saveSettings = jest.fn(async () => undefined);
		settings = {
			...DEFAULT_SETTINGS,
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
			cfpOpenresearchUrls: [],
			cfpCcfddlLocalPath: '',
			cfpCoreCsvPath: '',
		};
		service = new CFPService(harness.app, () => settings, saveSettings);
	});

	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	describe('getSeriesRefreshButtonDataviewJS', () => {
		it('builds default DataviewJS snippet calling window.__ZoteroAnnotationReviewerCFP.refreshSeries and respects custom setting override', () => {
			const script = getSeriesRefreshButtonDataviewJS();
			expect(script).toContain('dv.current()');
			expect(script).toContain('if (cur && cur["series-url"])');
			expect(script).toContain('dv.el("button", "Refresh events")');
			expect(script).toContain('addEventListener("click"');
			expect(script).toContain('e.preventDefault()');
			expect(script).toContain(
				'window.__ZoteroAnnotationReviewerCFP.refreshSeries(programUrl, seriesAcronym)'
			);

			const customSettings: MyPluginSettings = {
				...settings,
				cfpSeriesDataviewJSCode: 'const btn = dv.el("button", "Custom");',
			};
			expect(getSeriesRefreshButtonDataviewJS(customSettings)).toBe(
				'const btn = dv.el("button", "Custom");'
			);
		});
	});

	describe('refresh intervals and series map persistence', () => {
		it('evaluates shouldRefresh and shouldSeriesRefresh intervals and persists timestamps', async () => {
			expect(service.shouldRefresh()).toBe(true);
			expect(service.shouldSeriesRefresh()).toBe(true);

			await service.setLastFetchTime(Date.now() - 2 * 24 * 60 * 60 * 1000);
			expect(service.shouldRefresh()).toBe(false);
			expect(saveSettings).toHaveBeenCalledTimes(1);

			await service.setLastFetchTime(Date.now() - 6 * 24 * 60 * 60 * 1000);
			expect(service.shouldRefresh()).toBe(true);

			settings.cfpRefreshDays = 0;
			expect(service.shouldRefresh()).toBe(false);

			await service.setLastSeriesFetchTime(Date.now());
			settings.cfpSeriesRefreshDays = 10;
			expect(service.shouldSeriesRefresh()).toBe(false);

			await service.setLastSeriesFetchTime(Date.now() - 11 * 24 * 60 * 60 * 1000);
			expect(service.shouldSeriesRefresh()).toBe(true);

			settings.cfpSeriesRefreshDays = 0;
			expect(service.shouldSeriesRefresh()).toBe(false);
		});

		it('reads, saves, and updates cfpSeriesMap entries safely', async () => {
			settings.cfpSeriesMap = {
				CONF: { programUrl: 'http://p', lastUpdate: 0 },
			};
			expect(service.getSeriesMap()).toEqual({
				CONF: { programUrl: 'http://p', lastUpdate: 0 },
			});

			await service.saveSeriesMap({
				CONF: { programUrl: 'http://p2', lastUpdate: 5 },
			});
			expect(settings.cfpSeriesMap.CONF.programUrl).toBe('http://p2');

			await service.updateSeriesLastUpdate('CONF');
			expect(settings.cfpSeriesMap.CONF.lastUpdate).toBeGreaterThan(5);

			await service.updateSeriesLastUpdate('UNKNOWN');
		});
	});

	describe('saveManualCFP and syncToNotes', () => {
		it('writes manual CFP notes with normalized dates, optional series folder/note, and empty tag fallback', async () => {
			await service.saveManualCFP(
				makeItem({
					acronym: 'SOLO: 2026?',
					series: undefined,
					start: 'May 18th, 2026',
					end: 'not a date',
					submissionDdl: '',
					url: undefined,
				})
			);

			const solo = harness.getContent('CFP/SOLO 2026.md') ?? '';
			expect(solo).toContain('acronym: "SOLO: 2026?"');
			expect(solo).toContain('submission_ddl: ""');
			expect(solo).toContain('start: "2026-05-18"');
			expect(solo).toContain('end: "not a date"');
			expect(solo).toContain('tags: ["cfp"]');
			expect(solo).not.toContain('series:');
			expect(solo).not.toContain('url:');

			// Empty default tags and sanitized fallback filename
			settings.cfpDefaultTags = [];
			settings.cfpNoteDir = '   ';
			await service.saveManualCFP(
				makeItem({ acronym: '???', series: undefined })
			);
			const fallbackNote = harness.getContent('CFP/cfp.md') ?? '';
			expect(fallbackNote).not.toContain('tags:');
			expect(fallbackNote).toContain('url: "http://conf.example.org"');

			// Series note + linked event note
			settings.cfpDefaultTags = ['cfp'];
			settings.cfpNoteDir = 'CFP';
			await service.saveManualCFP(
				makeItem({
					acronym: 'WAIFI 2016',
					series: 'WAIFI',
					start: 'Jul 13, 2016',
					end: 'Jul 15, 2016',
					submissionDdl: 'May 1, 2016',
				})
			);
			const eventText = harness.getContent('CFP/WAIFI/WAIFI 2016.md') ?? '';
			expect(eventText).toContain('series: "[[WAIFI Series]]"');
			expect(eventText).toContain('submission_ddl: "2016-05-01"');
			expect(eventText).toContain('start: "2016-07-13"');
			expect(eventText).toContain('end: "2016-07-15"');
			expect(harness.getContent('CFP/WAIFI/WAIFI Series.md')).toContain(
				'cfp-series: true'
			);
		});

		it('overwrites existing manual notes, handles race-condition File/Folder already exists, and rethrows fatal errors', async () => {
			harness.addFile('CFP/SOLO 2026.md', 'old content');
			await service.saveManualCFP(
				makeItem({ acronym: 'SOLO 2026', series: undefined })
			);
			expect(harness.getContent('CFP/SOLO 2026.md')).toContain(
				'acronym: "SOLO 2026"'
			);

			// Race condition: create throws "File already exists", getAbstractFileByPath then returns file
			const raceFile = harness.addFile('CFP/RACE 2026.md', 'initial');
			let lookupCount = 0;
			const origGet =
				harness.mockApp.vault.getAbstractFileByPath.getMockImplementation()!;
			harness.mockApp.vault.getAbstractFileByPath.mockImplementation(
				(p: string) => {
					if (p === 'CFP/RACE 2026.md') {
						lookupCount += 1;
						return lookupCount === 1
							? null
							: (raceFile as unknown as ReturnType<typeof origGet>);
					}
					return origGet(p);
				}
			);
			await service.saveManualCFP(
				makeItem({ acronym: 'RACE 2026', series: undefined })
			);
			expect(harness.getContent('CFP/RACE 2026.md')).toContain(
				'acronym: "RACE 2026"'
			);
			harness.mockApp.vault.getAbstractFileByPath.mockImplementation(origGet);

			// Fatal folder error rethrows
			harness.mockApp.vault.createFolder.mockRejectedValueOnce(
				new Error('permission denied')
			);
			await expect(
				service.saveManualCFP(
					makeItem({
						acronym: 'LOCKED 2026',
						series: 'LOCKED_SERIES',
					})
				)
			).rejects.toThrow('permission denied');
		});

		it('syncToNotes skips blank acronyms and existing notes while counting newly created notes', async () => {
			harness.addFile('CFP/CONF/CONF 2025.md', 'keep me');

			const origCreate = harness.mockApp.vault.create.getMockImplementation()!;
			harness.mockApp.vault.create.mockImplementation(
				async (path: string, content: string) => {
					if (path.includes('BAD')) throw new Error('disk full');
					return origCreate(path, content);
				}
			);

			const created = await service.syncToNotes([
				makeItem({ acronym: '' }),
				makeItem({ acronym: 'CONF 2025' }),
				makeItem({ acronym: 'CONF 2026' }),
				makeItem({ acronym: 'BAD 2026', series: undefined }),
				makeItem({ acronym: 'SOLO 2026', series: undefined }),
			]);

			expect(created).toBe(2);
			expect(harness.getContent('CFP/CONF/CONF 2025.md')).toBe('keep me');
			expect(harness.getContent('CFP/CONF/CONF 2026.md')).toContain(
				'acronym: "CONF 2026"'
			);
			expect(harness.getContent('CFP/SOLO 2026.md')).toContain(
				'acronym: "SOLO 2026"'
			);
			expect(harness.getContent('CFP/BAD 2026.md')).toBeUndefined();
		});
	});

	describe('fetchAll and refresh HTTP pipelines (external requestUrl boundary)', () => {
		it('merges WikiCFP, CCFDDL, EasyChair, and OpenResearch sources in priority order and deduplicates acronyms', async () => {
			settings.cfpWikicfpUrls = ['https://wikicfp.example/ml'];
			settings.cfpCcfddlUrls = ['https://ccfddl.example/allconf.yml'];
			settings.cfpEasychairUrls = ['https://easychair.example/cfp'];
			settings.cfpOpenresearchUrls = ['https://openresearch.example/events'];

			const wikiHtml = `<table><tr>
				<td><a href="/e">OSDI 2026</a> USENIX OSDI</td>
				<td>Jul 1, 2026 - Jul 3, 2026</td>
				<td>Seattle</td>
				<td>Dec 1, 2025</td>
			</tr></table>`;
			const ecHtml = `<table><tr>
				<td>EC 2026</td><td>EasyChair Conf</td><td>Berlin</td><td>Feb 1, 2026</td>
			</tr></table>`;
			const orHtml = `<table><tr>
				<td>OR 2026</td><td>Osaka</td><td>Japan</td><td>OpenResearch Conf</td><td>1 Mar 2026</td><td>3 Mar 2026</td><td>15 Jan 2026</td>
			</tr></table>`;

			requestUrl.mockImplementation(async (req) => {
				const url = typeof req === 'string' ? req : req.url;
				if (url.includes('wikicfp')) return makeHttpResponse(200, wikiHtml);
				if (url.includes('ccfddl')) return makeHttpResponse(200, CCF_YAML);
				if (url.includes('easychair')) return makeHttpResponse(200, ecHtml);
				if (url.includes('openresearch')) return makeHttpResponse(200, orHtml);
				return makeHttpResponse(404, '');
			});

			await service.refresh();

			expect(harness.getContent('CFP/OSDI/OSDI 2026.md')).toContain(
				'cfp-source: "wikicfp"'
			);
			expect(harness.getContent('CFP/EC/EC 2026.md')).toContain(
				'cfp-source: "easychair"'
			);
			expect(harness.getContent('CFP/OR/OR 2026.md')).toContain(
				'cfp-source: "openresearch"'
			);
			expect(settings.cfpLastFetchTime).toBeGreaterThan(0);
			expect(getNoticeMessages()).toEqual([
				'Refreshing CFP from all sources...',
				'CFP refresh done. 3 items synced.',
			]);
		});

		it('falls back to local allconf.yml when CCFDDL URL fails and handles per-source refreshes & errors', async () => {
			await service.refreshWikiCFPUrls();
			await service.refreshCcfddlUrls();
			await service.refreshEasychairUrls();
			await service.refreshOpenresearchUrls();
			expect(getNoticeMessages()).toEqual(
				expect.arrayContaining([
					'WikiCFP URLs refreshed. 0 items synced.',
					'CCFDDL URLs refreshed. 0 items synced.',
					'EasyChair URLs refreshed. 0 items synced.',
					'OpenResearch URLs refreshed. 0 items synced.',
				])
			);

			// CCFDDL local fallback when URL returns 503
			settings.cfpCcfddlUrls = ['https://ccfddl.example/down.yml'];
			settings.cfpCcfddlLocalPath = 'data/allconf.yml';
			harness.addFile('data/allconf.yml', CCF_YAML);
			requestUrl.mockResolvedValueOnce(makeHttpResponse(503, ''));

			await service.refreshCcfddlUrls();
			expect(harness.getContent('CFP/OSDI/OSDI 2026.md')).toContain(
				'cfp-source: "ccfddl"'
			);
			expect(harness.getContent('CFP/OSDI/OSDI Series.md')).toContain(
				'rank_ccf: "A"'
			);

			// Error notices when vault sync fails
			harness.mockApp.vault.createFolder.mockRejectedValue(
				new Error('disk error')
			);
			settings.cfpNoteDir = 'LockedCFP';
			await service.refresh();
			await service.refreshWikiCFPUrls();
			await service.refreshCcfddlUrls();
			await service.refreshEasychairUrls();
			await service.refreshOpenresearchUrls();
			expect(getNoticeMessages()).toEqual(
				expect.arrayContaining([
					'CFP refresh failed. See console.',
					'WikiCFP URLs refresh failed. See console.',
					'CCFDDL URLs refresh failed. See console.',
					'EasyChair URLs refresh failed. See console.',
					'OpenResearch URLs refresh failed. See console.',
				])
			);
		});
	});

	describe('Series notes, rankings, WikiCFP series scan, daily refresh, and display list', () => {
		it('enriches Series notes with CCF and CORE ranks, preserves existing series-url, and updates ranks in bulk', async () => {
			settings.cfpCcfddlLocalPath = 'data/allconf.yml';
			settings.cfpCoreCsvPath = 'data/CORE.csv';
			harness.addFile('data/allconf.yml', CCF_YAML);
			harness.addFile('data/CORE.csv', CORE_CSV);
			harness.addFile(
				'CFP/OSDI/OSDI Series.md',
				'---\ntitle: "OSDI Series"\ncfp-series: true\nseries-url: "http://program/osdi"\n---\n',
				{ 'cfp-series': true, 'series-url': 'http://program/osdi' }
			);
			settings.cfpSeriesDataviewJSCode = 'CUSTOM_REFRESH();';

			await service.saveManualCFP(
				makeItem({ acronym: 'OSDI 2026', series: 'OSDI' })
			);
			await service.saveManualCFP(
				makeItem({ acronym: 'FOO 2026', series: 'FOO' })
			);

			const osdiSeries = harness.getContent('CFP/OSDI/OSDI Series.md') ?? '';
			expect(osdiSeries).toContain('series-url: "http://program/osdi"');
			expect(osdiSeries).toContain('```dataviewjs\nCUSTOM_REFRESH();\n```');
			expect(osdiSeries).toContain('rank_ccf: "A"');
			expect(osdiSeries).toContain('rank_thcpl: "B"');
			expect(osdiSeries).toContain('rank_sub: "SE"');
			expect(osdiSeries).toContain('rank_core: "A*"');
			expect(osdiSeries).toContain('rank_core_collection: "ICORE2026"');

			const fooSeries = harness.getContent('CFP/FOO/FOO Series.md') ?? '';
			expect(fooSeries).toContain('rank_core_status: "Unranked"');

			// Overwrite OSDI Series with stale rank lines and run updateAllSeriesNotesRank
			harness.setContent(
				'CFP/OSDI/OSDI Series.md',
				[
					'---',
					'title: "OSDI Series"',
					'cfp-series: true',
					'rank_ccf: "C"',
					'rank_core_status: "Old"',
					'---',
					'BODY',
				].join('\n')
			);
			const updatedRanks = await service.updateAllSeriesNotesRank();
			expect(updatedRanks).toBe(2);
			expect(harness.getContent('CFP/OSDI/OSDI Series.md')).toContain(
				'rank_ccf: "A"'
			);
			expect(harness.getContent('CFP/OSDI/OSDI Series.md')).toContain(
				'rank_core: "A*"'
			);
		});

		it('refreshes WikiCFP series index, refreshes individual series by URL, and updates DataviewJS blocks', async () => {
			jest.useFakeTimers();
			settings.cfpSeriesIndexLetters = ['O'];
			const indexHtml = `
				<a href="/cfp/program?id=1&s=OSDI&f=OSDI%3A+Operating+Systems+Design">OSDI</a>
				<a href="/cfp/program?id=2&s=PLAIN&f=Plain+Series+Name">PLAIN</a>
			`;
			const programHtml = `
				<h3>All CFPs on WikiCFP</h3>
				<table>
					<tr><th>Event</th><th>When</th><th>Where</th><th>Deadline</th></tr>
					<tr>
						<td><a href="/e1">OSDI 2026</a></td>
						<td>OSDI 2026<br>Jul 1, 2026 - Jul 3, 2026</td>
						<td>Seattle</td>
						<td>Dec 1, 2025</td>
					</tr>
				</table>
			`;

			requestUrl.mockImplementation(async (req) => {
				const url = typeof req === 'string' ? req : req.url;
				if (url.includes('series?t=c&i=O'))
					return makeHttpResponse(200, indexHtml);
				return makeHttpResponse(200, programHtml);
			});

			const progress: string[] = [];
			const idxPromise = service.refreshWikiCFPSeries((m) => progress.push(m));
			await jest.runAllTimersAsync();
			await idxPromise;

			expect(progress[0]).toContain('(O)');
			expect(harness.getContent('CFP/OSDI/OSDI Series.md')).toContain(
				'series-full-name: "Operating Systems Design"'
			);
			expect(harness.getContent('CFP/PLAIN/PLAIN Series.md')).toContain(
				'series-full-name: "Plain Series Name"'
			);

			await service.refreshSeriesByUrl(
				settings.cfpSeriesMap.OSDI.programUrl,
				'OSDI'
			);
			expect(harness.getContent('CFP/OSDI/OSDI 2026.md')).toContain(
				'acronym: "OSDI 2026"'
			);

			// Update DataviewJS code across all series notes
			settings.cfpSeriesDataviewJSCode = 'UPDATED_BUTTON_CODE();';
			const updatedJs = await service.updateAllSeriesNotesDataviewJS();
			expect(updatedJs).toBe(2);
			expect(harness.getContent('CFP/OSDI/OSDI Series.md')).toContain(
				'```dataviewjs\nUPDATED_BUTTON_CODE();\n```'
			);
		});

		it('schedules daily staggered series refreshes with 30-minute gaps once per day', async () => {
			jest.useFakeTimers();
			settings.cfpSeriesMap = {
				NEW: { programUrl: 'http://program/new', lastUpdate: 200 },
				OLD: { programUrl: 'http://program/old', lastUpdate: 100 },
			};
			requestUrl.mockImplementation(async (req) => {
				const url = typeof req === 'string' ? req : req.url;
				if (url.includes('/new')) throw new Error('offline');
				return makeHttpResponse(200, '<html><body></body></html>');
			});

			await service.runDailySeriesRefresh();
			const firstRunStamp = settings.cfpLastDailyRun;
			expect(firstRunStamp).toBeGreaterThan(0);

			await jest.advanceTimersByTimeAsync(0);
			await jest.runOnlyPendingTimersAsync();
			expect(getNoticeMessages()).toContain('CFP: OLD refreshed.');

			// Calling again within 24h is a no-op
			await service.runDailySeriesRefresh();
			expect(settings.cfpLastDailyRun).toBe(firstRunStamp);
		});

		it('partitions upcoming and past CFP notes based on submission_ddl', async () => {
			harness.addFile('CFP/CONF/CONF Series.md', '', { 'cfp-series': true });
			harness.addFile('CFP/CONF/CONF 2999.md', '', {
				acronym: 'CONF 2999',
				'full-name': 'Future Conf',
				location: 'Future City',
				submission_ddl: '2998-12-01',
				'cfp-source': 'wikicfp',
			});
			harness.addFile('CFP/CONF/CONF 2000.md', '', {
				acronym: 'CONF 2000',
				'full-name': 'Past Conf',
				location: 'Past City',
				submission_ddl: '2000-01-01',
				'cfp-source': 'wikicfp',
			});

			const { upcoming, past } = await service.getCFPNotesForDisplay();
			expect(upcoming.map((e) => e.item.acronym)).toEqual(['CONF 2999']);
			expect(past.map((e) => e.item.acronym)).toEqual(['CONF 2000']);
		});
	});
});
