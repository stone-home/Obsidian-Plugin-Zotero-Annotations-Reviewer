import { fetchOpenresearch } from './cfp-openresearch';
import { requestUrl } from 'obsidian';

jest.mock('obsidian', () => ({
	...jest.requireActual('obsidian'),
	requestUrl: jest.fn()
}));

describe('cfp-openresearch', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('parses OpenResearch HTML and returns CFPItem array', async () => {
		const html = `
		<table>
		<tr><th>Acronym</th><th>City</th><th>Country</th><th>Name</th><th>Start</th><th>End</th><th>Submission deadline</th></tr>
		<tr>
			<td>SPRA 2026</td>
			<td>Osaka</td>
			<td>Japan</td>
			<td>6th Symposium on Pattern Recognition and Applications</td>
			<td>19 March 2026</td>
			<td>21 March 2026</td>
			<td>5 February 2026</td>
		</tr>
		</table>`;
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: html });

		const results = await fetchOpenresearch(['https://openresearch.org/events']);

		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({
			acronym: 'SPRA 2026',
			fullName: expect.stringContaining('Pattern Recognition'),
			location: 'Osaka, Japan',
			submissionDdl: '5 February 2026',
			source: 'openresearch',
			url: 'https://openresearch.org/events'
		});
		expect(results[0].start).toBe('19 March 2026');
		expect(results[0].end).toBe('21 March 2026');
	});

	it('skips invalid rows and handles empty response', async () => {
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: '<table><tr><th>Acronym</th></tr></table>' });

		const results = await fetchOpenresearch(['https://openresearch.org/empty']);

		expect(results).toHaveLength(0);
	});
});
