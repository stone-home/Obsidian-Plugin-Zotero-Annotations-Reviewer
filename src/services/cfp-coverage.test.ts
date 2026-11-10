import { App, Notice, TFile } from 'obsidian';
import { CFPService } from './cfp';
import type { CFPItem } from '../types';
import { fetchWikiCFP } from './cfp-wikicfp';
import { fetchCcfddl, parseCcfddlYaml } from './cfp-ccfddl';
import { fetchEasychair } from './cfp-easychair';
import { fetchOpenresearch } from './cfp-openresearch';
import { fetchWikiCFPSeriesIndex, fetchSeriesEvents } from './cfp-wikicfp-series';

jest.mock('obsidian', () => ({
	...jest.requireActual('obsidian'),
	Notice: jest.fn(),
}));
jest.mock('./cfp-wikicfp', () => ({ fetchWikiCFP: jest.fn() }));
jest.mock('./cfp-ccfddl', () => ({
	...jest.requireActual('./cfp-ccfddl'),
	fetchCcfddl: jest.fn(),
}));
jest.mock('./cfp-easychair', () => ({ fetchEasychair: jest.fn() }));
jest.mock('./cfp-openresearch', () => ({ fetchOpenresearch: jest.fn() }));
jest.mock('./cfp-wikicfp-series', () => ({
	fetchWikiCFPSeriesIndex: jest.fn(),
	fetchSeriesEvents: jest.fn(),
}));

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

interface FakeVault {
	files: Map<string, { file: TFile; content: string }>;
	folders: Set<string>;
	frontmatter: Map<string, Record<string, unknown>>;
	addFile: (
		path: string,
		content?: string,
		frontmatter?: Record<string, unknown>
	) => TFile;
	content: (path: string) => string | undefined;
}

function installFakeVault(app: App): FakeVault {
	const files = new Map<string, { file: TFile; content: string }>();
	const folders = new Set<string>();
	const frontmatter = new Map<string, Record<string, unknown>>();

	const makeFile = (path: string): TFile => {
		const file = new TFile() as any;
		const parts = path.split('/');
		const name = parts[parts.length - 1];
		file.path = path;
		file.name = name;
		file.basename = name.replace(/\.md$/, '');
		file.parent =
			parts.length > 1
				? { name: parts[parts.length - 2], path: parts.slice(0, -1).join('/') }
				: null;
		return file;
	};

	const vault = app.vault as any;
	vault.getAbstractFileByPath = jest.fn((path: string) => {
		if (files.has(path)) return files.get(path)!.file;
		if (folders.has(path)) return { path };
		return null;
	});
	vault.createFolder = jest.fn(async (path: string) => {
		folders.add(path);
	});
	vault.create = jest.fn(async (path: string, content: string) => {
		if (files.has(path)) throw new Error('File already exists.');
		files.set(path, { file: makeFile(path), content });
	});
	vault.modify = jest.fn(async (file: any, content: string) => {
		files.get(file.path)!.content = content;
	});
	vault.read = jest.fn(async (file: any) => files.get(file.path)!.content);
	vault.getMarkdownFiles = jest.fn(() =>
		Array.from(files.values()).map((f) => f.file)
	);
	(app.metadataCache as any).getFileCache = jest.fn((file: any) => {
		const fm = frontmatter.get(file.path);
		return fm ? { frontmatter: fm } : null;
	});

	return {
		files,
		folders,
		frontmatter,
		addFile: (path, content = '', fm) => {
			const file = makeFile(path);
			files.set(path, { file, content });
			if (fm) frontmatter.set(path, fm);
			return file;
		},
		content: (path) => files.get(path)?.content,
	};
}

const makeItem = (overrides: Partial<CFPItem> = {}): CFPItem => ({
	acronym: 'CONF 2026',
	fullName: 'Conf 2026',
	location: 'Somewhere',
	submissionDdl: 'Feb 1, 2026',
	source: 'wikicfp',
	series: 'CONF',
	url: 'http://conf.example.org',
	...overrides,
});

const noticeMessages = (): string[] =>
	(Notice as unknown as jest.Mock).mock.calls.map((c) => c[0]);

describe('CFPService coverage', () => {
	let app: App;
	let saveSettings: jest.Mock;
	let settings: any;
	let service: CFPService;
	let vault: FakeVault;

	beforeAll(() => {
		jest.spyOn(console, 'log').mockImplementation(() => {});
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		jest.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterAll(() => {
		jest.restoreAllMocks();
	});

	beforeEach(() => {
		jest.clearAllMocks();
		parseCcfddlYaml('[]');
		(fetchWikiCFP as jest.Mock).mockReset().mockResolvedValue([]);
		(fetchCcfddl as jest.Mock).mockReset().mockResolvedValue([]);
		(fetchEasychair as jest.Mock).mockReset().mockResolvedValue([]);
		(fetchOpenresearch as jest.Mock).mockReset().mockResolvedValue([]);
		(fetchWikiCFPSeriesIndex as jest.Mock).mockReset().mockResolvedValue([]);
		(fetchSeriesEvents as jest.Mock).mockReset().mockResolvedValue([]);

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
			cfpOpenresearchUrls: [],
			cfpCcfddlLocalPath: '',
			cfpCoreCsvPath: '',
		};
		service = new CFPService(app, () => settings, saveSettings);
		vault = installFakeVault(app);
	});

	describe('saveManualCFP', () => {
		it('writes a note without series at the CFP root and normalises ordinal dates', async () => {
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

			expect(vault.folders.has('CFP')).toBe(true);
			const content = vault.content('CFP/SOLO 2026.md')!;
			expect(content.startsWith('---\n')).toBe(true);
			expect(content.endsWith('\n---\n\n')).toBe(true);
			expect(content).toContain('acronym: "SOLO: 2026?"');
			expect(content).toContain('submission_ddl: ""');
			expect(content).toContain('start: "2026-05-18"');
			expect(content).toContain('end: "not a date"');
			expect(content).toContain('cfp-source: "wikicfp"');
			expect(content).toContain('tags: ["cfp"]');
			expect(content).not.toContain('series:');
			expect(content).not.toContain('url:');
		});

		it('omits tags when the default tag list is empty and falls back to "cfp" file name', async () => {
			settings.cfpDefaultTags = [];
			settings.cfpNoteDir = '  ';

			await service.saveManualCFP(
				makeItem({ acronym: '???', series: undefined })
			);

			const content = vault.content('CFP/cfp.md')!;
			expect(content).not.toContain('tags:');
			expect(content).toContain('url: "http://conf.example.org"');
		});

		it('creates the series folder, series note and event note linked to the series', async () => {
			await service.saveManualCFP(makeItem());

			expect(vault.folders.has('CFP/CONF')).toBe(true);
			const event = vault.content('CFP/CONF/CONF 2026.md')!;
			expect(event).toContain('series: "[[CONF Series]]"');
			expect(event).toContain('submission_ddl: "2026-02-01"');

			const series = vault.content('CFP/CONF/CONF Series.md')!;
			expect(series).toContain('title: "CONF Series"');
			expect(series).toContain('cfp-series: true');
			expect(series).toContain('FROM [[CONF Series]]');
			expect(series).not.toContain('series-url');
			expect(series).not.toContain('```dataviewjs');
			expect(series).not.toContain('rank_');
		});

		it('overwrites an existing note through vault.modify', async () => {
			vault.addFile('CFP/SOLO 2026.md', 'old');

			await service.saveManualCFP(
				makeItem({ acronym: 'SOLO 2026', series: undefined })
			);

			expect((app.vault as any).create).not.toHaveBeenCalled();
			expect(vault.content('CFP/SOLO 2026.md')).toContain('acronym: "SOLO 2026"');
		});

		it('modifies the file when create reports that it already exists', async () => {
			const file = new TFile() as any;
			file.path = 'CFP/SOLO 2026.md';
			let lookups = 0;
			(app.vault as any).getAbstractFileByPath = jest.fn((path: string) => {
				if (path !== 'CFP/SOLO 2026.md') return null;
				lookups++;
				return lookups > 1 ? file : null;
			});
			(app.vault as any).create = jest
				.fn()
				.mockRejectedValue(new Error('File already exists.'));
			(app.vault as any).modify = jest.fn().mockResolvedValue(undefined);

			await service.saveManualCFP(
				makeItem({ acronym: 'SOLO 2026', series: undefined })
			);

			expect((app.vault as any).modify).toHaveBeenCalledWith(
				file,
				expect.stringContaining('acronym: "SOLO 2026"')
			);
		});

		it('rethrows unexpected create errors', async () => {
			(app.vault as any).create = jest
				.fn()
				.mockRejectedValue(new Error('disk full'));

			await expect(
				service.saveManualCFP(makeItem({ series: undefined }))
			).rejects.toThrow('disk full');
		});

		it('ignores "Folder already exists" but rethrows other folder errors', async () => {
			(app.vault as any).createFolder = jest
				.fn()
				.mockRejectedValue(new Error('Folder already exists.'));
			await service.saveManualCFP(
				makeItem({ acronym: 'SOLO 2026', series: undefined })
			);
			expect(vault.content('CFP/SOLO 2026.md')).toBeDefined();

			(app.vault as any).createFolder = jest
				.fn()
				.mockRejectedValue(new Error('permission denied'));
			await expect(
				service.saveManualCFP(
					makeItem({ acronym: 'OTHER 2026', series: undefined })
				)
			).rejects.toThrow('permission denied');
			expect(vault.content('CFP/OTHER 2026.md')).toBeUndefined();
		});
	});

	describe('syncToNotes', () => {
		it('creates new notes, skips existing ones and items without acronym', async () => {
			vault.addFile('CFP/CONF/CONF 2025.md', 'keep me');

			const created = await service.syncToNotes([
				makeItem({ acronym: '' }),
				makeItem({ acronym: 'CONF 2025' }),
				makeItem({ acronym: 'CONF 2026' }),
				makeItem({ acronym: 'SOLO 2026', series: undefined }),
			]);

			expect(created).toBe(2);
			expect(vault.content('CFP/CONF/CONF 2025.md')).toBe('keep me');
			expect(vault.content('CFP/CONF/CONF 2026.md')).toContain(
				'acronym: "CONF 2026"'
			);
			expect(vault.content('CFP/SOLO 2026.md')).toContain('acronym: "SOLO 2026"');
			expect(vault.content('CFP/CONF/CONF Series.md')).toContain(
				'cfp-series: true'
			);
		});

		it('does not count notes whose creation fails', async () => {
			const realCreate = (app.vault as any).create;
			(app.vault as any).create = jest.fn(
				async (path: string, content: string) => {
					if (path.includes('BAD')) throw new Error('disk full');
					return realCreate(path, content);
				}
			);

			const created = await service.syncToNotes([
				makeItem({ acronym: 'BAD 2026', series: undefined }),
				makeItem({ acronym: 'GOOD 2026', series: undefined }),
			]);

			expect(created).toBe(1);
			expect(vault.content('CFP/BAD 2026.md')).toBeUndefined();
			expect(console.error).toHaveBeenCalledWith(
				'[CFP] failed to create file:',
				'CFP/BAD 2026.md',
				expect.any(Error)
			);
		});

		it('falls back to default dir and tags when settings are malformed', async () => {
			settings.cfpNoteDir = '';
			settings.cfpDefaultTags = 'cfp';

			const created = await service.syncToNotes([
				makeItem({ acronym: 'SOLO 2026', series: undefined }),
			]);

			expect(created).toBe(1);
			expect(vault.content('CFP/SOLO 2026.md')).toContain('tags: ["cfp"]');
		});
	});

	describe('series note content and ranking', () => {
		it('keeps the series-url of an existing series note and renders the refresh button', async () => {
			vault.addFile('CFP/CONF/CONF Series.md', 'old', {
				'cfp-series': true,
				'series-url': 'http://program/conf',
			});
			settings.cfpSeriesDataviewJSCode = 'CUSTOM_CODE();';

			await service.saveManualCFP(makeItem());

			const series = vault.content('CFP/CONF/CONF Series.md')!;
			expect(series).toContain('series-url: "http://program/conf"');
			expect(series).toContain('```dataviewjs\nCUSTOM_CODE();\n```');
			expect(series.indexOf('```dataviewjs')).toBeLessThan(
				series.indexOf('```dataview\n')
			);
		});

		it('writes CCF ranks from the local allconf.yml and CORE ranks from the CSV', async () => {
			settings.cfpCcfddlLocalPath = 'data/allconf.yml';
			settings.cfpCoreCsvPath = '/data/CORE.csv';
			vault.addFile('data/allconf.yml', CCF_YAML);
			vault.addFile('data/CORE.csv', CORE_CSV);

			await service.saveManualCFP(
				makeItem({ acronym: 'OSDI 2026', series: 'OSDI' })
			);

			const series = vault.content('CFP/OSDI/OSDI Series.md')!;
			expect(series).toContain('rank_ccf: "A"');
			expect(series).toContain('rank_thcpl: "B"');
			expect(series).toContain('rank_sub: "SE"');
			expect(series).toContain('rank_core: "A*"');
			expect(series).toContain('rank_core_collection: "ICORE2026"');
			expect(series).not.toContain('rank_core_status');
		});

		it('writes the CORE status for unranked series and caches the parsed CSV', async () => {
			settings.cfpCoreCsvPath = 'data/CORE.csv';
			vault.addFile('data/CORE.csv', CORE_CSV);

			await service.saveManualCFP(
				makeItem({ acronym: 'FOO 2026', series: 'FOO' })
			);
			await service.saveManualCFP(
				makeItem({ acronym: 'OSDI 2026', series: 'OSDI' })
			);

			const foo = vault.content('CFP/FOO/FOO Series.md')!;
			expect(foo).toContain('rank_core_status: "Unranked"');
			expect(foo).toContain('rank_core_collection: "ICORE2023"');
			expect(foo).not.toContain('rank_core: ');
			expect(vault.content('CFP/OSDI/OSDI Series.md')).toContain(
				'rank_core: "A*"'
			);
			expect((app.vault as any).read).toHaveBeenCalledTimes(1);
		});

		it('writes no ranks when the CORE CSV and local YAML are missing or unreadable', async () => {
			settings.cfpCcfddlLocalPath = 'data/missing.yml';
			settings.cfpCoreCsvPath = 'data/missing.csv';

			await service.saveManualCFP(
				makeItem({ acronym: 'OSDI 2026', series: 'OSDI' })
			);
			expect(vault.content('CFP/OSDI/OSDI Series.md')).not.toContain('rank_');
			expect(console.warn).toHaveBeenCalledWith(
				'[CFP] CORE CSV file not found at path:',
				'data/missing.csv'
			);

			vault.addFile('data/missing.yml', CCF_YAML);
			vault.addFile('data/missing.csv', CORE_CSV);
			(app.vault as any).read = jest
				.fn()
				.mockRejectedValue(new Error('io error'));

			await service.saveManualCFP(
				makeItem({ acronym: 'OSDI 2027', series: 'OSDI' })
			);
			expect(vault.content('CFP/OSDI/OSDI Series.md')).not.toContain('rank_');
			expect(console.warn).toHaveBeenCalledWith(
				'[CFP] failed to read/parse CORE CSV at',
				'data/missing.csv',
				expect.any(Error)
			);
			expect(console.warn).toHaveBeenCalledWith(
				'[CFP] failed to load local allconf.yml for CCF rank at',
				'data/missing.yml',
				expect.any(Error)
			);
		});

		it('refreshWikiCFPSeries writes series notes with url, display name and progress messages', async () => {
			(fetchWikiCFPSeriesIndex as jest.Mock).mockImplementation(
				async (onLetter: (l: string, c: number) => void) => {
					onLetter('O', 2);
					return [
						{
							id: '1',
							seriesAcronym: 'OSDI',
							fullName: 'OSDI: Operating Systems: Design',
							programUrl: 'http://program/osdi',
						},
						{
							id: '2',
							seriesAcronym: 'PLAIN',
							fullName: 'Plain Name',
							programUrl: 'http://program/plain',
						},
						{
							id: '3',
							seriesAcronym: 'EMPTY',
							fullName: 'EMPTY:',
							programUrl: 'http://program/empty',
						},
					];
				}
			);
			settings.cfpSeriesMap = {
				OSDI: { programUrl: 'http://program/osdi', lastUpdate: 77 },
				PLAIN: { programUrl: 'http://old', lastUpdate: 5 },
			};
			const progress: string[] = [];

			await service.refreshWikiCFPSeries((msg) => progress.push(msg));

			expect(fetchWikiCFPSeriesIndex).toHaveBeenCalledWith(
				expect.any(Function),
				undefined
			);
			expect(progress[0]).toContain('(A–Z)');
			expect(progress).toContain('Index O: 2 series');
			expect(progress[progress.length - 1]).toContain(
				'WikiCFP series index done'
			);

			const osdi = vault.content('CFP/OSDI/OSDI Series.md')!;
			expect(osdi).toContain('series-url: "http://program/osdi"');
			expect(osdi).toContain('series-full-name: "Operating Systems: Design"');
			expect(osdi).toContain(
				'window.__ZoteroAnnotationReviewerCFP.refreshSeries(programUrl, seriesAcronym);'
			);
			expect(vault.content('CFP/PLAIN/PLAIN Series.md')).toContain(
				'series-full-name: "Plain Name"'
			);
			expect(vault.content('CFP/EMPTY/EMPTY Series.md')).not.toContain(
				'series-full-name'
			);

			expect(settings.cfpSeriesMap).toEqual({
				OSDI: { programUrl: 'http://program/osdi', lastUpdate: 77 },
				PLAIN: { programUrl: 'http://program/plain', lastUpdate: 5 },
				EMPTY: { programUrl: 'http://program/empty', lastUpdate: 0 },
			});
			expect(settings.cfpLastSeriesFetchTime).toBeGreaterThan(0);
			expect(saveSettings).toHaveBeenCalled();
		});

		it('refreshWikiCFPSeries mentions the selected letters in progress', async () => {
			settings.cfpSeriesIndexLetters = ['A', 'B'];
			const progress: string[] = [];

			await service.refreshWikiCFPSeries((msg) => progress.push(msg));

			expect(progress[0]).toContain('(A, B)');
			expect(fetchWikiCFPSeriesIndex).toHaveBeenCalledWith(expect.any(Function), [
				'A',
				'B',
			]);
		});
	});

	describe('refreshSeriesByUrl and rank updates', () => {
		const seriesContent = [
			'---',
			'title: "OSDI Series"',
			'cfp-series: true',
			'rank_ccf: "C"',
			'  rank_core: "B"',
			'rank_core_status: "Old"',
			'---',
			'BODY',
		].join('\n');

		it('syncs events, updates the series map and rewrites rank lines of the series note', async () => {
			settings.cfpCcfddlLocalPath = 'data/allconf.yml';
			settings.cfpCoreCsvPath = 'data/CORE.csv';
			vault.addFile('data/allconf.yml', CCF_YAML);
			vault.addFile('data/CORE.csv', CORE_CSV);
			vault.addFile('CFP/OSDI/OSDI Series.md', seriesContent, {
				'cfp-series': true,
			});
			jest.spyOn(service, 'syncToNotes').mockResolvedValue(3);
			const events = [makeItem({ acronym: 'OSDI 2026', series: 'OSDI' })];
			(fetchSeriesEvents as jest.Mock).mockResolvedValue(events);
			const progress: string[] = [];
			const onProgress = (msg: string) => progress.push(msg);

			await service.refreshSeriesByUrl('http://program/osdi', 'OSDI', onProgress);

			expect(fetchSeriesEvents).toHaveBeenCalledWith(
				'http://program/osdi',
				'OSDI',
				onProgress
			);
			expect(progress).toEqual([
				'Fetching events...',
				'Found 1 events, syncing to notes...',
				'Synced 3 events.',
			]);
			expect(settings.cfpSeriesMap.OSDI.programUrl).toBe('http://program/osdi');
			expect(settings.cfpSeriesMap.OSDI.lastUpdate).toBeGreaterThan(0);
			expect(vault.content('CFP/OSDI/OSDI Series.md')).toBe(
				[
					'---',
					'title: "OSDI Series"',
					'cfp-series: true',
					'rank_ccf: "A"',
					'rank_thcpl: "B"',
					'rank_sub: "SE"',
					'rank_core: "A*"',
					'rank_core_collection: "ICORE2026"',
					'---',
					'BODY',
				].join('\n')
			);
		});

		it('still reports success when the rank update throws', async () => {
			vault.addFile('CFP/OSDI/OSDI Series.md', seriesContent);
			jest.spyOn(service, 'syncToNotes').mockResolvedValue(0);
			(app.vault as any).read = jest
				.fn()
				.mockRejectedValue(new Error('io error'));
			const progress: string[] = [];

			await service.refreshSeriesByUrl('http://program/osdi', 'OSDI', (msg) =>
				progress.push(msg)
			);

			expect(progress[progress.length - 1]).toBe('Synced 0 events.');
			expect(console.warn).toHaveBeenCalledWith(
				'[CFP] failed to update Series rank after refreshSeriesByUrl for',
				'OSDI',
				expect.any(Error)
			);
		});

		it('updateAllSeriesNotesRank updates series notes and leaves notes without frontmatter untouched', async () => {
			settings.cfpCoreCsvPath = 'data/CORE.csv';
			vault.addFile('data/CORE.csv', CORE_CSV);
			vault.addFile('CFP/OSDI/OSDI Series.md', seriesContent, {
				'cfp-series': true,
			});
			vault.addFile('CFP/FOO/FOO Series.md', 'no frontmatter here', {
				'cfp-series': true,
			});
			vault.addFile('CFP/OSDI/OSDI 2026.md', 'event', { acronym: 'OSDI 2026' });
			vault.addFile('Other/X Series.md', 'outside', { 'cfp-series': true });
			vault.addFile('CFP/ Series.md', 'blank name', { 'cfp-series': true });

			const updated = await service.updateAllSeriesNotesRank();

			expect(updated).toBe(2);
			const osdi = vault.content('CFP/OSDI/OSDI Series.md')!;
			expect(osdi).toContain('rank_core: "A*"');
			expect(osdi).not.toContain('rank_ccf');
			expect(osdi).not.toContain('rank_core_status');
			expect(osdi.endsWith('---\nBODY')).toBe(true);
			expect(vault.content('CFP/FOO/FOO Series.md')).toBe('no frontmatter here');
			expect(vault.content('Other/X Series.md')).toBe('outside');
			expect(vault.content('CFP/OSDI/OSDI 2026.md')).toBe('event');
		});

		it('updateAllSeriesNotesRank does not count notes whose update fails', async () => {
			vault.addFile('CFP/OSDI/OSDI Series.md', seriesContent, {
				'cfp-series': true,
			});
			(app.vault as any).read = jest
				.fn()
				.mockRejectedValue(new Error('io error'));

			expect(await service.updateAllSeriesNotesRank()).toBe(0);
			expect(console.warn).toHaveBeenCalledWith(
				'[CFP] failed to update Series rank for',
				'CFP/OSDI/OSDI Series.md',
				expect.any(Error)
			);
		});
	});

	describe('refresh commands', () => {
		it('refresh syncs all sources, stores the fetch time and reports the count', async () => {
			settings.cfpWikicfpUrls = ['w'];
			settings.cfpOpenresearchUrls = ['o'];
			(fetchWikiCFP as jest.Mock).mockResolvedValue([
				makeItem({ acronym: 'A 2026', series: undefined }),
			]);
			(fetchOpenresearch as jest.Mock).mockResolvedValue([
				makeItem({
					acronym: 'a 2026',
					series: undefined,
					source: 'openresearch',
				}),
				makeItem({
					acronym: 'B 2026',
					series: undefined,
					source: 'openresearch',
				}),
			]);

			await service.refresh();

			expect(vault.content('CFP/A 2026.md')).toContain('cfp-source: "wikicfp"');
			expect(vault.content('CFP/B 2026.md')).toContain(
				'cfp-source: "openresearch"'
			);
			expect(settings.cfpLastFetchTime).toBeGreaterThan(0);
			expect(noticeMessages()).toEqual([
				'Refreshing CFP from all sources...',
				'CFP refresh done. 2 items synced.',
			]);
		});

		it('refresh reports failure and keeps the last fetch time', async () => {
			settings.cfpWikicfpUrls = ['w'];
			(fetchWikiCFP as jest.Mock).mockRejectedValue(new Error('network'));

			await service.refresh();

			expect(settings.cfpLastFetchTime).toBe(0);
			expect(noticeMessages()).toContain('CFP refresh failed. See console.');
		});

		it('per-source refreshes sync nothing when no URLs are configured', async () => {
			await service.refreshWikiCFPUrls();
			await service.refreshCcfddlUrls();
			await service.refreshEasychairUrls();
			await service.refreshOpenresearchUrls();

			expect(fetchWikiCFP).not.toHaveBeenCalled();
			expect(fetchCcfddl).not.toHaveBeenCalled();
			expect(fetchEasychair).not.toHaveBeenCalled();
			expect(fetchOpenresearch).not.toHaveBeenCalled();
			expect(noticeMessages()).toEqual(
				expect.arrayContaining([
					'WikiCFP URLs refreshed. 0 items synced.',
					'CCFDDL URLs refreshed. 0 items synced.',
					'EasyChair URLs refreshed. 0 items synced.',
					'OpenResearch URLs refreshed. 0 items synced.',
				])
			);
		});

		it('per-source refreshes report failures through notices', async () => {
			settings.cfpWikicfpUrls = ['w'];
			settings.cfpEasychairUrls = ['e'];
			settings.cfpOpenresearchUrls = ['o'];
			(fetchWikiCFP as jest.Mock).mockRejectedValue(new Error('w down'));
			(fetchEasychair as jest.Mock).mockRejectedValue(new Error('e down'));
			(fetchOpenresearch as jest.Mock).mockRejectedValue(new Error('o down'));

			await service.refreshWikiCFPUrls();
			await service.refreshEasychairUrls();
			await service.refreshOpenresearchUrls();

			jest.spyOn(service, 'syncToNotes').mockRejectedValue(
				new Error('sync down')
			);
			await service.refreshCcfddlUrls();

			expect(noticeMessages()).toEqual(
				expect.arrayContaining([
					'WikiCFP URLs refresh failed. See console.',
					'EasyChair URLs refresh failed. See console.',
					'OpenResearch URLs refresh failed. See console.',
					'CCFDDL URLs refresh failed. See console.',
				])
			);
		});

		it('CCFDDL refresh falls back to the local allconf.yml when the URL fetch fails', async () => {
			settings.cfpCcfddlUrls = ['http://ccfddl/all.yml'];
			settings.cfpCcfddlLocalPath = 'data/allconf.yml';
			vault.addFile('data/allconf.yml', CCF_YAML);
			(fetchCcfddl as jest.Mock).mockRejectedValue(new Error('offline'));

			await service.refreshCcfddlUrls();

			const event = vault.content('CFP/OSDI/OSDI 2026.md')!;
			expect(event).toContain('cfp-source: "ccfddl"');
			expect(event).toContain('location: "Seattle"');
			expect(event).toContain('url: "https://osdi.example.org"');
			expect(vault.content('CFP/OSDI/OSDI Series.md')).toContain('rank_ccf: "A"');
			expect(noticeMessages()).toContain(
				'CCFDDL URLs refreshed. 1 items synced.'
			);
		});

		it('CCFDDL refresh syncs nothing when the local fallback is missing or unreadable', async () => {
			settings.cfpCcfddlLocalPath = 'data/allconf.yml';

			await service.refreshCcfddlUrls();
			expect(console.warn).toHaveBeenCalledWith(
				'[CFP] Local allconf.yml not found at',
				'data/allconf.yml'
			);

			vault.addFile('data/allconf.yml', CCF_YAML);
			(app.vault as any).read = jest
				.fn()
				.mockRejectedValue(new Error('io error'));
			await service.refreshCcfddlUrls();

			expect(console.warn).toHaveBeenCalledWith(
				'[CFP] Failed to read/parse local allconf.yml fallback at',
				'data/allconf.yml',
				expect.any(Error)
			);
			expect(
				noticeMessages().filter(
					(m) => m === 'CCFDDL URLs refreshed. 0 items synced.'
				)
			).toHaveLength(2);
		});
	});

	describe('runDailySeriesRefresh', () => {
		afterEach(() => {
			jest.useRealTimers();
		});

		it('does nothing beyond stamping the run when no series has a program URL', async () => {
			settings.cfpSeriesMap = { CONF: { programUrl: '', lastUpdate: 0 } };
			const timeoutSpy = jest.spyOn(global, 'setTimeout');

			await service.runDailySeriesRefresh();

			expect(settings.cfpLastDailyRun).toBeGreaterThan(0);
			expect(timeoutSpy).not.toHaveBeenCalled();
			timeoutSpy.mockRestore();
		});

		it('refreshes series oldest first with a 30 minute gap and reports each result', async () => {
			jest.useFakeTimers();
			settings.cfpSeriesMap = {
				NEW: { programUrl: 'http://new', lastUpdate: 200 },
				OLD: { programUrl: 'http://old', lastUpdate: 100 },
			};
			const refreshSpy = jest
				.spyOn(service, 'refreshSeriesByUrl')
				.mockImplementation(async (_url, key, onProgress) => {
					onProgress?.('working');
					if (key === 'NEW') throw new Error('boom');
				});

			await service.runDailySeriesRefresh();
			await jest.advanceTimersByTimeAsync(0);

			expect(refreshSpy).toHaveBeenCalledTimes(1);
			expect(refreshSpy).toHaveBeenCalledWith(
				'http://old',
				'OLD',
				expect.any(Function)
			);
			expect(noticeMessages()).toContain('CFP: OLD refreshed.');
			expect(console.log).toHaveBeenCalledWith('[CFP]', 'OLD', 'working');

			await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

			expect(refreshSpy).toHaveBeenCalledTimes(2);
			expect(refreshSpy).toHaveBeenLastCalledWith(
				'http://new',
				'NEW',
				expect.any(Function)
			);
			expect(noticeMessages()).not.toContain('CFP: NEW refreshed.');
			expect(console.warn).toHaveBeenCalledWith(
				'[CFP] daily refresh failed',
				'NEW',
				expect.any(Error)
			);
		});
	});

	describe('updateAllSeriesNotesDataviewJS', () => {
		it('replaces, inserts or skips the refresh button block depending on the note', async () => {
			settings.cfpSeriesDataviewJSCode = 'NEW_CODE();';
			const table = '```dataview\nTABLE x\n```\n';
			vault.addFile(
				'CFP/A/A Series.md',
				'---\nfm\n---\n```dataviewjs\nOLD_CODE();\n```\n\n' + table,
				{ 'cfp-series': true, 'series-url': 'http://a' }
			);
			vault.addFile('CFP/B/B Series.md', '---\nfm\n---\n' + table, {
				'cfp-series': true,
				'series-url': 'http://b',
			});
			vault.addFile(
				'CFP/C/C Series.md',
				'---\nfm\n---\n```dataviewjs\nNEW_CODE();\n```\n\n' + table,
				{ 'cfp-series': true, 'series-url': 'http://c' }
			);
			vault.addFile(
				'CFP/D/D Series.md',
				'---\nfm\n---\n```dataviewjs\nOLD_CODE();\n```\n',
				{ 'cfp-series': true }
			);
			vault.addFile('CFP/E/E Series.md', 'no blocks', {
				'cfp-series': true,
				'series-url': 'http://e',
			});
			vault.addFile('CFP/A/A 2026.md', '```dataviewjs\nOLD_CODE();\n```', {
				acronym: 'A 2026',
			});
			vault.addFile('Other/Z Series.md', '```dataviewjs\nOLD_CODE();\n```', {
				'cfp-series': true,
				'series-url': 'http://z',
			});

			const updated = await service.updateAllSeriesNotesDataviewJS();

			expect(updated).toBe(2);
			expect(vault.content('CFP/A/A Series.md')).toBe(
				'---\nfm\n---\n```dataviewjs\nNEW_CODE();\n```\n\n' + table
			);
			expect(vault.content('CFP/B/B Series.md')).toBe(
				'---\nfm\n---\n```dataviewjs\nNEW_CODE();\n```\n\n' + table
			);
			expect(vault.content('CFP/D/D Series.md')).toContain('OLD_CODE();');
			expect(vault.content('CFP/E/E Series.md')).toBe('no blocks');
			expect(vault.content('CFP/A/A 2026.md')).toContain('OLD_CODE();');
			expect(vault.content('Other/Z Series.md')).toContain('OLD_CODE();');
			expect((app.vault as any).modify).toHaveBeenCalledTimes(2);
		});

		it('continues after a note fails to update', async () => {
			vault.addFile('CFP/A/A Series.md', '```dataviewjs\nOLD\n```', {
				'cfp-series': true,
				'series-url': 'http://a',
			});
			vault.addFile('CFP/B/B Series.md', '```dataviewjs\nOLD\n```', {
				'cfp-series': true,
				'series-url': 'http://b',
			});
			const realRead = (app.vault as any).read;
			(app.vault as any).read = jest.fn(async (file: any) => {
				if (file.path.includes('/A/')) throw new Error('io error');
				return realRead(file);
			});

			expect(await service.updateAllSeriesNotesDataviewJS()).toBe(1);
			expect(vault.content('CFP/A/A Series.md')).toBe('```dataviewjs\nOLD\n```');
			expect(vault.content('CFP/B/B Series.md')).toContain('Refresh events');
			expect(console.warn).toHaveBeenCalledWith(
				'[CFP] failed to update Series note:',
				'CFP/A/A Series.md',
				expect.any(Error)
			);
		});
	});

	describe('series and note lookups', () => {
		beforeEach(() => {
			vault.addFile('CFP/OSDI/OSDI Series.md', '', {
				'cfp-series': true,
				'series-url': 'http://program/osdi',
			});
			vault.addFile('CFP/OSDI/OSDI 2025.md', '', {
				acronym: 'OSDI 2025',
				series: '[[OSDI Series]]',
				'full-name': 'OSDI 2025 full',
				location: 'Boston',
				start: '2025-07-01',
				end: '2025-07-03',
				'submission-ddl': '2024-12-01',
				'cfp-source': 'wikicfp',
				url: 'http://osdi25',
			});
			vault.addFile('CFP/OSDI/OSDI 2026.md', '', {
				acronym: 'OSDI 2026',
				title: 'OSDI 2026 title',
				submission_ddl: '2025-12-01',
			});
			vault.addFile('CFP/OSDI/OSDI 2027.md', '', {
				acronym: 'OSDI 2027',
				submission_ddl: 'TBD',
			});
			vault.addFile('CFP/OSDI/OSDI 2028.md', '', { acronym: 'OSDI 2028' });
			vault.addFile('CFP/OSDI/broken.md', '', { location: 'Nowhere' });
			vault.addFile('CFP/OSDI/plain.md', '');
			vault.addFile('CFP/NSDI 2026.md', '', {
				acronym: 'NSDI 2026',
				submission_ddl: '2025-09-01',
			});
			vault.addFile('Notes/OSDI 2030.md', '', {
				acronym: 'OSDI 2030',
				submission_ddl: '2029-12-01',
			});
		});

		it('getSeriesInfoByAcronym returns the series note and its latest event', () => {
			const info = service.getSeriesInfoByAcronym(' OSDI ');

			expect(info).not.toBeNull();
			expect(info!.seriesName).toBe('OSDI');
			expect(info!.seriesNotePath).toBe('CFP/OSDI/OSDI Series.md');
			expect(info!.latestEvent).toEqual({
				path: 'CFP/OSDI/OSDI 2026.md',
				item: {
					acronym: 'OSDI 2026',
					series: undefined,
					fullName: 'OSDI 2026 title',
					location: '',
					start: undefined,
					end: undefined,
					submissionDdl: '2025-12-01',
					source: 'manual',
					url: undefined,
				},
			});
		});

		it('getSeriesInfoByAcronym strips the year to find the series', () => {
			const info = service.getSeriesInfoByAcronym('OSDI 2031');

			expect(info!.seriesName).toBe('OSDI');
			expect(info!.latestEvent!.path).toBe('CFP/OSDI/OSDI 2026.md');
		});

		it('getSeriesInfoByAcronym returns null for blank input or unknown series', () => {
			expect(service.getSeriesInfoByAcronym('   ')).toBeNull();
			expect(service.getSeriesInfoByAcronym(undefined as any)).toBeNull();
			expect(service.getSeriesInfoByAcronym('NSDI 2026')).toBeNull();
		});

		it('getCFPNoteInfoByPath describes a series note', () => {
			const info = service.getCFPNoteInfoByPath('CFP/OSDI/OSDI Series.md');

			expect(info).toMatchObject({
				isSeries: true,
				seriesNotePath: 'CFP/OSDI/OSDI Series.md',
				seriesName: 'OSDI',
			});
			expect(info!.latestEvent!.item.acronym).toBe('OSDI 2026');
		});

		it('getCFPNoteInfoByPath describes an event note with its parsed frontmatter', () => {
			const info = service.getCFPNoteInfoByPath('CFP/OSDI/OSDI 2025.md') as any;

			expect(info.isSeries).toBe(false);
			expect(info.event).toEqual({
				path: 'CFP/OSDI/OSDI 2025.md',
				item: {
					acronym: 'OSDI 2025',
					series: 'OSDI',
					fullName: 'OSDI 2025 full',
					location: 'Boston',
					start: '2025-07-01',
					end: '2025-07-03',
					submissionDdl: '2024-12-01',
					source: 'wikicfp',
					url: 'http://osdi25',
				},
			});
			expect(info.latestEvent.item.acronym).toBe('OSDI 2026');
		});

		it('getCFPNoteInfoByPath derives the series from the parent folder or the acronym', () => {
			const fromFolder = service.getCFPNoteInfoByPath(
				'CFP/OSDI/OSDI 2028.md'
			) as any;
			expect(fromFolder.isSeries).toBe(false);
			expect(fromFolder.latestEvent.item.acronym).toBe('OSDI 2026');

			const fromAcronym = service.getCFPNoteInfoByPath('CFP/NSDI 2026.md') as any;
			expect(fromAcronym.event.item.acronym).toBe('NSDI 2026');
			expect(fromAcronym.latestEvent.path).toBe('CFP/NSDI 2026.md');
		});

		it('getCFPNoteInfoByPath returns null outside the CFP folder, for missing files and notes without frontmatter', () => {
			expect(service.getCFPNoteInfoByPath('Notes/OSDI 2030.md')).toBeNull();
			expect(service.getCFPNoteInfoByPath('CFP/missing.md')).toBeNull();
			expect(service.getCFPNoteInfoByPath('CFP/OSDI/plain.md')).toBeNull();
		});

		it('findBestMatchingCFPForConference returns no event when the folder only has series notes', async () => {
			vault.files.clear();
			vault.addFile('CFP/OSDI/OSDI Series.md', '', { 'cfp-series': true });
			vault.addFile('CFP/OSDI/broken.md', '', { location: 'Nowhere' });

			expect(
				await service.findBestMatchingCFPForConference({
					conferenceName: 'OSDI 2026',
				})
			).toEqual({ event: null });
		});

		it('findBestMatchingCFPForConference returns no event when the acronym matches but neither year nor series note does', async () => {
			const result = await service.findBestMatchingCFPForConference({
				acronymFromNote: 'NSDI',
				year: 2031,
			});

			expect(result).toEqual({ event: null });
		});

		it('findBestMatchingCFPForConference extracts the year from the conference name', async () => {
			const result = await service.findBestMatchingCFPForConference({
				conferenceName: 'OSDI 2026',
			});

			expect(result.event!.path).toBe('CFP/OSDI/OSDI 2026.md');
			expect(result.seriesNotePath).toBe('CFP/OSDI/OSDI Series.md');
			expect(result.latestSeriesDdl).toBe('2025-12-01');

			const otherYear = await service.findBestMatchingCFPForConference({
				proceedingsTitle: 'OSDI 1999',
			});
			expect(otherYear).toEqual({ event: null });
		});
	});
});
