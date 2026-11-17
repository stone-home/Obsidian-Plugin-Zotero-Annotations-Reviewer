import { fetchOpenresearch } from '../../../src/services/cfp-openresearch';
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

describe('fetchOpenresearch', () => {
	beforeEach(() => {
		resetObsidianMocks();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('parses OpenResearch HTML rows with city/country, dates, and fallback fields', async () => {
		const html = `
		<table>
		<tr><th>Acronym</th><th>City</th><th>Country</th><th>Name</th><th>Start</th><th>End</th><th>Submission deadline</th></tr>
		<tr>
			<td>SPRA 2026</td>
			<td>Osaka</td>
			<td>Japan</td>
			<td>6th Symposium on Pattern Recognition &amp; Applications</td>
			<td>19 March 2026</td>
			<td>21 March 2026</td>
			<td>5 February 2026</td>
		</tr>
		<tr>
			<td></td>
			<td></td>
			<td></td>
			<td>Unnamed Acronym Event</td>
		</tr>
		<tr><td></td><td>City</td><td>Country</td><td></td></tr>
		<tr><td>SHORT</td><td>Only Two</td></tr>
		</table>`;
		requestUrl.mockResolvedValueOnce(makeResponse(200, html));

		const results = await fetchOpenresearch(['https://openresearch.org/events']);

		expect(results).toHaveLength(2);
		expect(results[0]).toEqual({
			acronym: 'SPRA 2026',
			series: 'SPRA',
			fullName: '6th Symposium on Pattern Recognition & Applications',
			location: 'Osaka, Japan',
			start: '19 March 2026',
			end: '21 March 2026',
			submissionDdl: '5 February 2026',
			source: 'openresearch',
			url: 'https://openresearch.org/events',
		});
		expect(results[1]).toMatchObject({
			acronym: 'Unnamed-Acronym-Event',
			location: 'N/A',
			submissionDdl: 'N/A',
		});
	});

	it('handles empty URLs, non-200 status, thrown requests, and delays across multiple URLs', async () => {
		jest.useFakeTimers();
		const row =
			'<tr><td>OR 2026</td><td>Paris</td><td>France</td><td>Conf</td><td>1 May 2026</td><td>2 May 2026</td><td>1 Feb 2026</td></tr>';
		requestUrl
			.mockResolvedValueOnce(makeResponse(500, ''))
			.mockRejectedValueOnce(new Error('timeout'))
			.mockResolvedValueOnce(makeResponse(200, `<table>${row}</table>`));

		const promise = fetchOpenresearch([
			'   ',
			'https://openresearch.org/500',
			'https://openresearch.org/err',
			'https://openresearch.org/ok',
		]);
		await jest.runAllTimersAsync();
		const results = await promise;

		expect(requestUrl).toHaveBeenCalledTimes(3);
		expect(results).toHaveLength(1);
		expect(results[0].acronym).toBe('OR 2026');
	});
});
