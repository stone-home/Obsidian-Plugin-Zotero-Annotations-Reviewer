import { fetchEasychair } from './cfp-easychair';
import { requestUrl } from 'obsidian';

jest.mock('obsidian', () => ({
	...jest.requireActual('obsidian'),
	requestUrl: jest.fn()
}));

describe('cfp-easychair', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('parses EasyChair HTML and returns CFPItem array', async () => {
		const html = `
		<table>
		<tr><th>Acronym</th><th>Name</th><th>Location</th><th>Submission</th><th>Start date</th></tr>
		<tr>
			<td>MODA26</td>
			<td>7th International Workshop on Monitoring, Observability</td>
			<td>Hamburg, Germany</td>
			<td>Feb 23, 2026</td>
			<td>Jun 26, 2026</td>
		</tr>
		<tr>
			<td>ICCAI 2026</td>
			<td>ACM Computing and Artificial Intelligence</td>
			<td>Okinawa, Japan</td>
			<td>Feb 5, 2026</td>
			<td></td>
		</tr>
		</table>`;
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: html });

		const results = await fetchEasychair(['https://easychair.org/cfp/area.cgi?area=1']);

		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0]).toMatchObject({
			acronym: 'MODA26',
			fullName: expect.stringContaining('Monitoring'),
			location: 'Hamburg, Germany',
			submissionDdl: 'Feb 23, 2026',
			source: 'easychair',
			url: 'https://easychair.org/cfp/area.cgi?area=1'
		});
	});

	it('returns empty array on non-200 response', async () => {
		(requestUrl as jest.Mock).mockResolvedValue({ status: 404, text: '' });

		const results = await fetchEasychair(['https://easychair.org/cfp/x']);

		expect(results).toHaveLength(0);
	});
});
