import { fetchEasychair } from '../../../src/services/cfp-easychair';
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

describe('fetchEasychair', () => {
	beforeEach(() => {
		resetObsidianMocks();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('parses EasyChair HTML tables, strips entities, and skips malformed rows', async () => {
		const html = `
		<table>
		<tr><th>Acronym</th><th>Name</th><th>Location</th><th>Submission</th><th>Start date</th></tr>
		<tr>
			<td>MODA26</td>
			<td>7th International Workshop on Monitoring &amp; Observability</td>
			<td>Hamburg,&nbsp;Germany</td>
			<td>Feb 23, 2026</td>
			<td>Jun 26, 2026</td>
		</tr>
		<tr>
			<td></td>
			<td>Full Name Only Event</td>
			<td></td>
			<td>Mar 1, 2026</td>
			<td></td>
		</tr>
		<tr><td>SHORT</td><td>Missing columns</td></tr>
		<tr><td></td><td></td><td>Loc</td><td>Feb 1, 2026</td></tr>
		<tr><td>NODDL</td><td>No Deadline</td><td>Loc</td><td></td></tr>
		</table>`;
		requestUrl.mockResolvedValueOnce(makeResponse(200, html));

		const results = await fetchEasychair([
			'https://easychair.org/cfp/area.cgi?area=1',
		]);

		expect(results).toHaveLength(2);
		expect(results[0]).toEqual({
			acronym: 'MODA26',
			series: 'MODA',
			fullName: '7th International Workshop on Monitoring & Observability',
			location: 'Hamburg, Germany',
			start: 'Jun 26, 2026',
			end: undefined,
			submissionDdl: 'Feb 23, 2026',
			source: 'easychair',
			url: 'https://easychair.org/cfp/area.cgi?area=1',
		});
		expect(results[1]).toMatchObject({
			acronym: 'Full-Name-Only-Event',
			location: 'N/A',
			start: undefined,
			submissionDdl: 'Mar 1, 2026',
		});
	});

	it('skips empty URLs, non-200 responses, and network failures while delaying between URLs', async () => {
		jest.useFakeTimers();
		const html =
			'<table><tr><td>EC 2026</td><td>EasyChair Conf</td><td>Berlin</td><td>Jan 1, 2026</td></tr></table>';
		requestUrl
			.mockResolvedValueOnce(makeResponse(404, ''))
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValueOnce(makeResponse(200, html));

		const promise = fetchEasychair([
			'',
			'https://easychair.org/cfp/404',
			'https://easychair.org/cfp/err',
			'https://easychair.org/cfp/ok',
		]);
		await jest.runAllTimersAsync();
		const results = await promise;

		expect(requestUrl).toHaveBeenCalledTimes(3);
		expect(results).toHaveLength(1);
		expect(results[0].acronym).toBe('EC 2026');
	});
});
