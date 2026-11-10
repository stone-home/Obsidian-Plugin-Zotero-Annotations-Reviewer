import { requestUrl } from 'obsidian';
import {
	delay,
	fetchSeriesEvents,
	fetchWikiCFPSeriesIndex,
	parseSeriesTableToItems,
	randomDelayMs,
	stripHtmlLite,
} from './cfp-wikicfp-series';
import { fetchWikiCFP } from './cfp-wikicfp';

jest.mock('obsidian', () => ({
	...jest.requireActual('obsidian'),
	requestUrl: jest.fn(),
}));

jest.mock('./cfp-wikicfp', () => ({
	fetchWikiCFP: jest.fn().mockResolvedValue([]),
}));

describe('WikiCFP series additional coverage', () => {
	let timeoutSpy: jest.SpyInstance;

	beforeAll(() => {
		jest.spyOn(console, 'log').mockImplementation(() => {});
		jest.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterAll(() => {
		jest.restoreAllMocks();
	});

	beforeEach(() => {
		(requestUrl as jest.Mock).mockReset();
		(fetchWikiCFP as jest.Mock).mockReset().mockResolvedValue([]);
		timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((
			fn: () => void
		) => {
			fn();
			return 0;
		}) as any);
	});

	afterEach(() => {
		timeoutSpy.mockRestore();
	});

	describe('helpers', () => {
		it('randomDelayMs stays between 5 and 10 seconds', () => {
			const randomSpy = jest.spyOn(Math, 'random');
			randomSpy.mockReturnValue(0);
			expect(randomDelayMs()).toBe(5000);
			randomSpy.mockReturnValue(0.5);
			expect(randomDelayMs()).toBe(7500);
			randomSpy.mockRestore();
		});

		it('delay resolves after the requested timeout', async () => {
			await expect(delay(1234)).resolves.toBeUndefined();
			expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1234);
		});

		it('stripHtmlLite removes tags, decodes entities and collapses whitespace', () => {
			expect(
				stripHtmlLite(' <b>A&amp;B</b>&nbsp;&lt;x&gt;\n\n  <br/>done ')
			).toBe('A&B <x> done');
		});

		it('stripHtmlLite decodes each entity once', () => {
			expect(stripHtmlLite('&amp;lt;b&amp;gt; &amp;amp; &amp;nbsp;')).toBe(
				'&lt;b&gt; &amp; &nbsp;'
			);
		});
	});

	describe('fetchWikiCFPSeriesIndex', () => {
		const pageA = `
			<a href="/cfp/program?id=187&s=AOSD&f=Aspect-Oriented+Software+Development">AOSD</a>
			<a href="/cfp/program?id=187&s=AOSD&f=Aspect-Oriented+Software+Development">AOSD again</a>
			<a href="/cfp/program?id=9&s=A%26B">A&B</a>
		`;
		const pageB = `
			<a href="/cfp/program?id=187&s=AOSD&f=Duplicate+Across+Pages">AOSD</a>
			<a href='/cfp/program?id=20&s=BIG+DATA&f=Big%20Data%20Conf'>BIG DATA</a>
		`;

		it('parses, decodes and deduplicates series across the requested letters', async () => {
			(requestUrl as jest.Mock).mockImplementation(
				async ({ url }: { url: string }) => {
					if (url.endsWith('i=A')) return { status: 200, text: pageA };
					if (url.endsWith('i=B')) return { status: 200, text: pageB };
					if (url.endsWith('i=C')) return { status: 500, text: pageA };
					throw new Error('network');
				}
			);
			const progress: [string, number][] = [];

			const entries = await fetchWikiCFPSeriesIndex(
				(letter, count) => progress.push([letter, count]),
				['A', 'B', 'C', 'D']
			);

			expect((requestUrl as jest.Mock).mock.calls.map((c) => c[0].url)).toEqual([
				'http://www.wikicfp.com/cfp/series?t=c&i=A',
				'http://www.wikicfp.com/cfp/series?t=c&i=B',
				'http://www.wikicfp.com/cfp/series?t=c&i=C',
				'http://www.wikicfp.com/cfp/series?t=c&i=D',
			]);
			expect(entries).toEqual([
				{
					id: '187',
					seriesAcronym: 'AOSD',
					fullName: 'Aspect-Oriented Software Development',
					programUrl:
						'http://www.wikicfp.com/cfp/program?id=187&s=AOSD&f=Aspect-Oriented%20Software%20Development',
				},
				{
					id: '9',
					seriesAcronym: 'A&B',
					fullName: 'A&B',
					programUrl:
						'http://www.wikicfp.com/cfp/program?id=9&s=A%26B&f=A%26B',
				},
				{
					id: '20',
					seriesAcronym: 'BIG DATA',
					fullName: 'Big Data Conf',
					programUrl:
						'http://www.wikicfp.com/cfp/program?id=20&s=BIG%20DATA&f=Big%20Data%20Conf',
				},
			]);
			expect(progress).toEqual([
				['A', 2],
				['B', 3],
			]);
		});

		it('fetches all 26 index pages when no letters are given', async () => {
			(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: '' });

			const entries = await fetchWikiCFPSeriesIndex(undefined, []);

			expect(entries).toEqual([]);
			expect(requestUrl).toHaveBeenCalledTimes(26);
			expect((requestUrl as jest.Mock).mock.calls[25][0].url).toBe(
				'http://www.wikicfp.com/cfp/series?t=c&i=Z'
			);
			expect(timeoutSpy).toHaveBeenCalledTimes(25);
		});

		it('waits after a single requested letter', async () => {
			(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: '' });

			await fetchWikiCFPSeriesIndex(undefined, ['Q']);

			expect(requestUrl).toHaveBeenCalledTimes(1);
			expect(timeoutSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('parseSeriesTableToItems', () => {
		const wrap = (rows: string) =>
			`<h3>All CFPs on WikiCFP</h3><table><tr><td>Event</td><td>When</td><td>Where</td><td>Deadline</td></tr>${rows}</table>`;

		it('returns [] when the page has no table', () => {
			expect(
				parseSeriesTableToItems('<p>nothing</p>', 'http://program', 'X')
			).toEqual([]);
		});

		it('merges rowspan-based two-row entries', () => {
			const html = wrap(`
				<tr><td rowspan="2"><a href="/e1">ZEUS 2026</a></td><td colspan="3">Central European Workshop on Services</td></tr>
				<tr><td>Feb 19, 2026 - Feb 20, 2026</td><td>Vienna, Austria</td><td>Dec 1, 2025</td></tr>
			`);

			expect(parseSeriesTableToItems(html, 'http://program', 'ZEUS')).toEqual([
				{
					acronym: 'ZEUS 2026',
					series: 'ZEUS',
					fullName: 'Central European Workshop on Services',
					location: 'Vienna, Austria',
					start: 'Feb 19, 2026',
					end: 'Feb 20, 2026',
					submissionDdl: 'Dec 1, 2025',
					source: 'wikicfp',
					url: 'http://program',
				},
			]);
		});

		it('skips a rowspan entry whose second row is incomplete', () => {
			const html = wrap(`
				<tr><td rowspan=2><a>ZEUS 2025</a></td><td>Workshop</td></tr>
				<tr><td>Feb 1, 2025 - Feb 2, 2025</td><td>Vienna</td></tr>
			`);

			expect(parseSeriesTableToItems(html, 'http://program', 'ZEUS')).toEqual([]);
		});

		it('handles free-form dates, missing values, short rows and duplicates', () => {
			const html = wrap(`
				<tr><td>PLAIN 2026</td><td>Spring 2026</td><td></td><td>Jan 5, 2026</td></tr>
				<tr><td><a>NA 2026</a></td><td>N/A</td><td>Rome</td><td>Jan 6, 2026</td></tr>
				<tr><td><a>NODDL 2026</a></td><td>N/A</td><td>Rome</td><td>N/A</td></tr>
				<tr><td><a></a></td><td>N/A</td><td>Rome</td><td>Jan 7, 2026</td></tr>
				<tr><td><a>SHORT 2026</a></td><td>N/A</td></tr>
				<tr><td><a>plain 2026</a></td><td>N/A</td><td>Rome</td><td>Jan 8, 2026</td></tr>
			`);

			const items = parseSeriesTableToItems(html, 'http://program', 'S');

			expect(items.map((i) => i.acronym)).toEqual(['PLAIN 2026', 'NA 2026']);
			expect(items[0]).toMatchObject({
				fullName: 'PLAIN 2026',
				start: 'Spring 2026',
				end: undefined,
				location: 'N/A',
			});
			expect(items[1]).toMatchObject({
				start: undefined,
				end: undefined,
				location: 'Rome',
				submissionDdl: 'Jan 6, 2026',
			});
		});
	});

	describe('fetchSeriesEvents fallback crawling', () => {
		const item = (acronym: string, series?: string) => ({
			acronym,
			fullName: acronym,
			location: 'X',
			submissionDdl: '2026-02-01',
			source: 'wikicfp' as const,
			url: 'u',
			series,
		});

		it('crawls event and call URLs once each, keeps going after a failure and reports progress', async () => {
			const html = `
				<a href="/cfp/servlet/event.showcfp?eventid=11&copyownerid=1">E11</a>
				<a href="http://www.wikicfp.com/cfp/servlet/event.showcfp?eventid=12">E12</a>
				<a href="/cfp/servlet/event.showcfp?eventid=11">E11 again</a>
				<a href="/cfp/call?cid=abc&x=1">C1</a>
				<a href="http://www.wikicfp.com/cfp/call?cid=d e">C2</a>
				<a href="/cfp/call?cid=abc">C1 again</a>
			`;
			(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: html });
			(fetchWikiCFP as jest.Mock).mockImplementation(async ([url]: string[]) => {
				if (url.endsWith('eventid=11')) return [item('CONF 2026')];
				if (url.endsWith('eventid=12')) throw new Error('boom');
				if (url.endsWith('cid=abc'))
					return [item('conf 2026'), item('CONF 2025', 'OWN')];
				return [];
			});
			const progress: string[] = [];

			const events = await fetchSeriesEvents('http://program', 'CONF', (msg) =>
				progress.push(msg)
			);

			expect((fetchWikiCFP as jest.Mock).mock.calls.map((c) => c[0][0])).toEqual([
				'http://www.wikicfp.com/cfp/servlet/event.showcfp?eventid=11',
				'http://www.wikicfp.com/cfp/servlet/event.showcfp?eventid=12',
				'http://www.wikicfp.com/cfp/call?cid=abc',
				'http://www.wikicfp.com/cfp/call?cid=d',
			]);
			expect(progress).toEqual([
				'Event 1/4',
				'Event 2/4',
				'Event 3/4',
				'Event 4/4',
			]);
			expect(events.map((e) => [e.acronym, e.series])).toEqual([
				['CONF 2026', 'CONF'],
				['CONF 2025', 'OWN'],
			]);
			expect(timeoutSpy.mock.calls.filter((c) => c[1] === 800)).toHaveLength(3);
		});
	});
});
