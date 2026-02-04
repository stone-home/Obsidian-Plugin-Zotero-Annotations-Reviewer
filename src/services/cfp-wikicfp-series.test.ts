import { requestUrl } from 'obsidian';
import * as SeriesMod from './cfp-wikicfp-series';
import { fetchSeriesEvents } from './cfp-wikicfp-series';
import { fetchWikiCFP } from './cfp-wikicfp';

jest.mock('obsidian', () => ({
	...jest.requireActual('obsidian'),
	requestUrl: jest.fn()
}));

jest.mock('./cfp-wikicfp', () => ({
	fetchWikiCFP: jest.fn().mockResolvedValue([])
}));

describe('WikiCFP series helpers', () => {
	beforeEach(() => {
		(requestUrl as jest.Mock).mockReset();
		(fetchWikiCFP as jest.Mock).mockReset().mockResolvedValue([]);
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

	it('fetchSeriesEvents falls back to event URLs when no table present and deduplicates by acronym', async () => {
		const html = `
			<html><body>
				<a href="/cfp/servlet/event.showcfp?eventid=1">CONF 2026</a>
			</body></html>
		`;
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: html });

		(fetchWikiCFP as jest.Mock).mockResolvedValue([
			{
				acronym: 'CONF 2026',
				fullName: 'Conf 2026',
				location: 'X',
				start: '2026-06-01',
				end: '2026-06-03',
				submissionDdl: '2026-02-01',
				source: 'wikicfp',
				url: 'u1',
				series: undefined
			},
			{
				acronym: 'CONF 2026',
				fullName: 'Conf 2026 duplicate',
				location: 'Y',
				start: '2026-06-01',
				end: '2026-06-03',
				submissionDdl: '2026-02-01',
				source: 'wikicfp',
				url: 'u2',
				series: undefined
			}
		]);

		jest.spyOn(SeriesMod, 'delay').mockResolvedValue(undefined as any);

		const events = await fetchSeriesEvents('http://program', 'CONF');

		expect(fetchWikiCFP).toHaveBeenCalledTimes(1);
		expect(events).toHaveLength(1);
		expect(events[0].acronym).toBe('CONF 2026');
		expect(events[0].series).toBe('CONF');
	});

	it('fetchSeriesEvents uses fetchWikiCFP fallback when neither table nor event URLs exist', async () => {
		const html = `<html><body>No CFP table here</body></html>`;
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200, text: html });

		(fetchWikiCFP as jest.Mock).mockResolvedValue([
			{
				acronym: 'FALLBACK 2026',
				fullName: 'Fallback Conf',
				location: 'Z',
				start: '2026-01-01',
				end: '2026-01-03',
				submissionDdl: '2025-12-01',
				source: 'wikicfp',
				url: 'u'
			}
		]);

		const events = await fetchSeriesEvents('http://program', 'FB');

		expect(fetchWikiCFP).toHaveBeenCalledWith(['http://program']);
		expect(events).toHaveLength(1);
		expect(events[0].series).toBe('FB');
	});

	it('fetchSeriesEvents returns [] on non-200 status', async () => {
		(requestUrl as jest.Mock).mockResolvedValue({ status: 500, text: '' });
		const events = await fetchSeriesEvents('http://program', 'CONF');
		expect(events).toEqual([]);
		expect(fetchWikiCFP).not.toHaveBeenCalled();
	});

});

