import { fetchWikiCFP } from './cfp-wikicfp';
import { requestUrl } from 'obsidian';

jest.mock('obsidian', () => ({
	...jest.requireActual('obsidian'),
	requestUrl: jest.fn()
}));

describe('cfp-wikicfp', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('parses WikiCFP HTML and returns CFPItem array', async () => {
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
			<td><a href="/x">SPRA 2026</a> SPIE Symposium</td>
			<td>Mar 19, 2026 - Mar 21, 2026</td>
			<td>Osaka, Japan</td>
			<td>Feb 5, 2026</td>
		</tr>
		</table>`;
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: html });

		const results = await fetchWikiCFP(['https://wikicfp.com/call?q=ml']);

		expect(results).toHaveLength(2);
		expect(results[0]).toMatchObject({
			acronym: 'CHIL 2026',
			fullName: expect.stringContaining('AHLI'),
			location: 'Seattle, WA, USA',
			submissionDdl: 'Feb 4, 2026',
			source: 'wikicfp',
			url: 'https://wikicfp.com/call?q=ml'
		});
		expect(results[0].start).toBe('Jun 28, 2026');
		expect(results[0].end).toBe('Jun 30, 2026');
		expect(results[0].series).toBe('CHIL');
		expect(results[1].acronym).toBe('SPRA 2026');
		expect(results[1].series).toBe('SPRA');
	});

	it('skips empty URLs and handles request failure', async () => {
		(requestUrl as jest.Mock).mockRejectedValue(new Error('Network error'));

		const results = await fetchWikiCFP(['https://bad.url', '']);

		expect(results).toHaveLength(0);
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});
});
