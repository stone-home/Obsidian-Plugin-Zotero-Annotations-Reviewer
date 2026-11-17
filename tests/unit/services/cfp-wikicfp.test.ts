import { fetchWikiCFP } from '../../../src/services/cfp-wikicfp';
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

describe('fetchWikiCFP', () => {
	beforeEach(() => {
		resetObsidianMocks();
		jest.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	it('parses WikiCFP HTML tables, date ranges, single dates, deduplicates acronyms, and decodes entities once', async () => {
		const html = `
		<table>
		<tr><th>Event</th><th>When</th><th>Where</th><th>Deadline</th></tr>
		<tr>
			<td><a href="/cfp/servlet/event.showcfp?eventid=190779">CHIL 2026</a> AHLI Conference on Health, Inference, and Learning</td>
			<td>Jun 28, 2026 - Jun 30, 2026</td>
			<td>Seattle, WA, USA</td>
			<td>Feb 4, 2026</td>
		</tr>
		<tr>
			<td><a href="/x">chil 2026</a> Duplicate Row</td>
			<td>Jun 28, 2026 - Jun 30, 2026</td>
			<td>Seattle, WA, USA</td>
			<td>Feb 4, 2026</td>
		</tr>
		<tr>
			<td><a href="/x">R&amp;D 2026</a> Notes on &amp;lt;tags&amp;gt;</td>
			<td>Summer 2026</td>
			<td></td>
			<td>Feb 1, 2026</td>
		</tr>
		<tr>
			<td>Plain Event Title Without Link</td>
			<td>N/A</td>
			<td>Lyon, France</td>
			<td>Mar 1, 2026</td>
		</tr>
		<tr>
			<td><a href="/x">SKIP 2026</a></td>
			<td>N/A</td>
			<td>Rome</td>
			<td>N/A</td>
		</tr>
		<tr><td>Too</td><td>Short</td></tr>
		</table>`;
		requestUrl.mockResolvedValueOnce(makeResponse(200, html));

		const results = await fetchWikiCFP(['https://wikicfp.com/call?q=ml']);

		expect(results).toHaveLength(3);
		expect(results[0]).toEqual({
			acronym: 'CHIL 2026',
			series: 'CHIL',
			fullName: 'AHLI Conference on Health, Inference, and Learning',
			location: 'Seattle, WA, USA',
			start: 'Jun 28, 2026',
			end: 'Jun 30, 2026',
			submissionDdl: 'Feb 4, 2026',
			source: 'wikicfp',
			url: 'https://wikicfp.com/call?q=ml',
		});
		expect(results[1]).toMatchObject({
			acronym: 'R&D 2026',
			fullName: 'Notes on &lt;tags&gt;',
			location: 'N/A',
			start: 'Summer 2026',
			end: undefined,
		});
		expect(results[2]).toMatchObject({
			acronym: 'Plain-Event-Title-Without-Link',
			start: undefined,
			end: undefined,
			location: 'Lyon, France',
		});
	});

	it('skips empty URLs, non-200 status, and network errors while delaying across URLs', async () => {
		jest.useFakeTimers();
		const html =
			'<table><tr><td><a>A 2026</a></td><td>N/A</td><td>Loc</td><td>Feb 1, 2026</td></tr></table>';
		requestUrl
			.mockRejectedValueOnce(new Error('Network error'))
			.mockResolvedValueOnce(makeResponse(503, ''))
			.mockResolvedValueOnce(makeResponse(200, html));

		const promise = fetchWikiCFP([
			'https://bad.url',
			'',
			'https://503.url',
			'https://ok.url',
		]);
		await jest.runAllTimersAsync();
		const results = await promise;

		expect(requestUrl).toHaveBeenCalledTimes(3);
		expect(results).toHaveLength(1);
		expect(results[0].acronym).toBe('A 2026');
	});
});
