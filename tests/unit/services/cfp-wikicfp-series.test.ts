import {
	delay,
	fetchSeriesEvents,
	fetchWikiCFPSeriesIndex,
	parseSeriesTableToItems,
	randomDelayMs,
	stripHtmlLite,
} from '../../../src/services/cfp-wikicfp-series';
import { requestUrl, resetObsidianMocks } from '../../__mocks__/obsidian';

function makeResponse(status: number, text: string) {
	return {
		status,
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
		json: null,
		text,
	};
}

describe('cfp-wikicfp-series', () => {
	beforeEach(() => {
		resetObsidianMocks();
		jest.spyOn(console, 'log').mockImplementation(() => {});
		jest.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	describe('helpers', () => {
		it('randomDelayMs returns a value between 5000 and 10000 ms', () => {
			const randomSpy = jest.spyOn(Math, 'random');
			randomSpy.mockReturnValue(0);
			expect(randomDelayMs()).toBe(5000);
			randomSpy.mockReturnValue(0.5);
			expect(randomDelayMs()).toBe(7500);
			randomSpy.mockRestore();
		});

		it('delay resolves after the requested timeout', async () => {
			jest.useFakeTimers();
			let settled = false;
			const p = delay(1234).then(() => {
				settled = true;
			});
			expect(settled).toBe(false);
			await jest.advanceTimersByTimeAsync(1234);
			await p;
			expect(settled).toBe(true);
		});

		it('stripHtmlLite removes tags, collapses whitespace, and decodes each entity once', () => {
			expect(
				stripHtmlLite(' <b>A&amp;B</b>&nbsp;&lt;x&gt;\n\n  <br/>done ')
			).toBe('A&B <x> done');
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

		it('parses, decodes, and deduplicates series across requested letters', async () => {
			jest.useFakeTimers();
			requestUrl.mockImplementation(async (req) => {
				const url = typeof req === 'string' ? req : req.url;
				if (url.endsWith('i=A')) return makeResponse(200, pageA);
				if (url.endsWith('i=B')) return makeResponse(200, pageB);
				if (url.endsWith('i=C')) return makeResponse(500, pageA);
				throw new Error('network');
			});
			const progress: Array<[string, number]> = [];

			const promise = fetchWikiCFPSeriesIndex(
				(letter, count) => progress.push([letter, count]),
				['A', 'B', 'C', 'D']
			);
			await jest.runAllTimersAsync();
			const entries = await promise;

			expect(
				requestUrl.mock.calls.map(([req]) =>
					typeof req === 'string' ? req : req.url
				)
			).toEqual([
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

		it('fetches all 26 A–Z index pages when letters list is empty', async () => {
			jest.useFakeTimers();
			requestUrl.mockResolvedValue(makeResponse(200, ''));

			const promise = fetchWikiCFPSeriesIndex(undefined, []);
			await jest.runAllTimersAsync();
			const entries = await promise;

			expect(entries).toEqual([]);
			expect(requestUrl).toHaveBeenCalledTimes(26);
			const lastArg = requestUrl.mock.calls[25][0];
			expect(typeof lastArg === 'string' ? lastArg : lastArg.url).toBe(
				'http://www.wikicfp.com/cfp/series?t=c&i=Z'
			);
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

		it('merges rowspan-based two-row entries and skips incomplete rowspan pairs', () => {
			const mergedHtml = wrap(`
				<tr><td rowspan="2"><a href="/e1">ZEUS 2026</a></td><td colspan="3">Central European Workshop on Services</td></tr>
				<tr><td>Feb 19, 2026 - Feb 20, 2026</td><td>Vienna, Austria</td><td>Dec 1, 2025</td></tr>
			`);
			expect(
				parseSeriesTableToItems(mergedHtml, 'http://program', 'ZEUS')
			).toEqual([
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

			const incompleteHtml = wrap(`
				<tr><td rowspan=2><a>ZEUS 2025</a></td><td>Workshop</td></tr>
				<tr><td>Feb 1, 2025 - Feb 2, 2025</td><td>Vienna</td></tr>
			`);
			expect(
				parseSeriesTableToItems(incompleteHtml, 'http://program', 'ZEUS')
			).toEqual([]);
		});

		it('handles free-form dates, missing values, short rows, and duplicates', () => {
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

	describe('fetchSeriesEvents', () => {
		it('returns [] on non-200 HTTP status', async () => {
			requestUrl.mockResolvedValueOnce(makeResponse(500, ''));
			await expect(fetchSeriesEvents('http://program', 'CONF')).resolves.toEqual(
				[]
			);
		});

		it('parses primary "All CFPs on WikiCFP" table directly when present', async () => {
			const html = `
			<html><body>
				<h2>WAIFI: Workshop on Arithmetic of Finite Fields</h2>
				<h3>All CFPs on WikiCFP</h3>
				<table>
					<tr><th>Event</th><th>When</th><th>Where</th><th>Deadline</th></tr>
					<tr>
						<td><a href="/cfp/servlet/event.showcfp?eventid=12345">WAIFI 2016</a></td>
						<td>International Workshop on the Arithmetic of Finite Fields 2016<br>Jul 13, 2016 - Jul 15, 2016</td>
						<td>Ghent University, Ghent, Belgium</td>
						<td>May 1, 2016</td>
					</tr>
				</table>
			</body></html>`;
			requestUrl.mockResolvedValueOnce(makeResponse(200, html));

			const events = await fetchSeriesEvents(
				'http://www.wikicfp.com/cfp/program?id=3000&s=WAIFI',
				'WAIFI'
			);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				acronym: 'WAIFI 2016',
				series: 'WAIFI',
				location: 'Ghent University, Ghent, Belgium',
				submissionDdl: 'May 1, 2016',
				start: 'Jul 13, 2016',
				end: 'Jul 15, 2016',
			});
		});

		it('crawls unique event and call URLs when primary table is absent and deduplicates acronyms', async () => {
			jest.useFakeTimers();
			const programHtml = `
				<a href="/cfp/servlet/event.showcfp?eventid=11&copyownerid=1">E11</a>
				<a href="http://www.wikicfp.com/cfp/servlet/event.showcfp?eventid=12">E12</a>
				<a href="/cfp/servlet/event.showcfp?eventid=11">E11 again</a>
				<a href="/cfp/call?cid=abc&x=1">C1</a>
				<a href="/cfp/call?cid=abc">C1 again</a>
			`;
			const event11Html = `
				<table><tr>
					<td><a href="/x">CONF 2026</a> Conf 2026</td>
					<td>Jun 1, 2026 - Jun 3, 2026</td>
					<td>Tokyo</td>
					<td>Feb 1, 2026</td>
				</tr></table>`;
			const callAbcHtml = `
				<table>
					<tr>
						<td><a href="/x">conf 2026</a> Duplicate</td>
						<td>Jun 1, 2026 - Jun 3, 2026</td>
						<td>Tokyo</td>
						<td>Feb 1, 2026</td>
					</tr>
					<tr>
						<td><a href="/x">OWN 2025</a> Own Series Conference</td>
						<td>Jun 1, 2025 - Jun 3, 2025</td>
						<td>Seoul</td>
						<td>Feb 1, 2025</td>
					</tr>
				</table>`;

			requestUrl.mockImplementation(async (req) => {
				const url = typeof req === 'string' ? req : req.url;
				if (url === 'http://program') return makeResponse(200, programHtml);
				if (url.endsWith('eventid=11')) return makeResponse(200, event11Html);
				if (url.endsWith('eventid=12')) throw new Error('boom');
				if (url.endsWith('cid=abc')) return makeResponse(200, callAbcHtml);
				return makeResponse(404, '');
			});

			const progress: string[] = [];
			const promise = fetchSeriesEvents('http://program', 'CONF', (msg) =>
				progress.push(msg)
			);
			await jest.runAllTimersAsync();
			const events = await promise;

			expect(progress).toEqual(['Event 1/3', 'Event 2/3', 'Event 3/3']);
			expect(events.map((e) => [e.acronym, e.series])).toEqual([
				['CONF 2026', 'CONF'],
				['OWN 2025', 'OWN'],
			]);
		});

		it('falls back to generic WikiCFP table parse on program URL when no event URLs exist', async () => {
			const irregularHtml = `
				<div>Irregular wrapper without heading</div>
				<table><tr>
					<td><a href="/other">FALLBACK</a> Fallback Conf</td>
					<td>Jan 1, 2026 - Jan 3, 2026</td>
					<td>Zurich</td>
					<td>Dec 1, 2025</td>
				</tr></table>`;
			// Note: parseSeriesTableToItems parses the first <table> on page if present, so return empty on first request and populated on second fallback request
			requestUrl
				.mockResolvedValueOnce(
					makeResponse(200, '<html><body>No links</body></html>')
				)
				.mockResolvedValueOnce(makeResponse(200, irregularHtml));

			const events = await fetchSeriesEvents('http://program', 'FB');
			expect(requestUrl).toHaveBeenCalledTimes(2);
			expect(events).toHaveLength(1);
			expect(events[0].acronym).toBe('FALLBACK');
			expect(events[0].series).toBe('FALLBACK');
		});
	});
});
