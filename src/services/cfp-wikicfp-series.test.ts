import { requestUrl } from 'obsidian';
import { fetchSeriesEvents } from './cfp-wikicfp-series';

jest.mock('obsidian', () => ({
	...jest.requireActual('obsidian'),
	requestUrl: jest.fn()
}));

// Do not actually call into generic WikiCFP parser here – we only want to
// test the series program-page table parsing behaviour.
jest.mock('./cfp-wikicfp', () => ({
	fetchWikiCFP: jest.fn().mockResolvedValue([])
}));

describe('fetchSeriesEvents (WikiCFP series program page)', () => {
	beforeEach(() => {
		(requestUrl as jest.Mock).mockReset();
	});

	it('parses events from "All CFPs on WikiCFP" table (WAIFI-style page)', async () => {
		const html = `
		<html>
		<body>
			<h2>WAIFI: Workshop on Arithmetic of Finite Fields</h2>
			<center><h3>All CFPs on WikiCFP</h3></center>
			<table border="1" cellpadding="3" cellspacing="1">
				<tr>
					<th>Event</th><th>When</th><th>Where</th><th>Deadline</th>
				</tr>
				<tr>
					<td><a href="/cfp/servlet/event.showcfp?eventid=12345">WAIFI 2016</a></td>
					<td>
						International Workshop on the Arithmetic of Finite Fields 2016<br>
						Jul 13, 2016 - Jul 15, 2016
					</td>
					<td>Ghent University, Ghent, Belgium</td>
					<td>May 1, 2016</td>
				</tr>
			</table>
		</body>
		</html>`;

		(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: html });

		const programUrl =
			'http://www.wikicfp.com/cfp/program?id=3000&s=WAIFI&f=Workshop%20on%20Arithmetic%20of%20Finite%20Fields';

		const events = await fetchSeriesEvents(programUrl, 'WAIFI');

		expect(events).toHaveLength(1);
		const ev = events[0];
		expect(ev.acronym).toBe('WAIFI 2016');
		expect(ev.series).toBe('WAIFI');
		expect(ev.fullName).toContain('International Workshop on the Arithmetic of Finite Fields');
		expect(ev.location).toBe('Ghent University, Ghent, Belgium');
		expect(ev.submissionDdl).toBe('May 1, 2016');
		expect(ev.start).toBe('Jul 13, 2016');
		expect(ev.end).toBe('Jul 15, 2016');
		expect(ev.url).toBe(programUrl);
	});
});

