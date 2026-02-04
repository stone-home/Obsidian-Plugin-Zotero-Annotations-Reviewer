import { requestUrl } from 'obsidian';
import yaml from 'js-yaml';
import { fetchCcfddl } from './cfp-ccfddl';

jest.mock('obsidian', () => ({
	...jest.requireActual('obsidian'),
	requestUrl: jest.fn()
}));

jest.mock('js-yaml', () => ({
	__esModule: true,
	default: { load: jest.fn() }
}));

describe('fetchCcfddl', () => {
	beforeEach(() => {
		(requestUrl as jest.Mock).mockReset();
	});

	it('parses CCFDDL YAML into CFPItems with correct fields', async () => {
		// Provide parsed YAML structure directly via mocked js-yaml.
		(yaml as any).load.mockReturnValue([
			{
				title: 'CONF',
				description: 'Test Conference on Something',
				confs: [
					{
						year: 2026,
						link: 'https://example.org/conf2026',
						date: '2026-06-01 -- 2026-06-03',
						place: 'Paris, France',
						timezone: 'UTC+1',
						timeline: [
							{ abstract_deadline: '2026-01-10', deadline: 'TBD' },
							{ deadline: '2026-02-01' }
						]
					}
				]
			}
		]);

		(requestUrl as jest.Mock).mockResolvedValue({
			status: 200,
			text: 'dummy'
		});

		const items = await fetchCcfddl(['https://ccfddl.com/allconf.yml']);

		expect(items).toHaveLength(1);
		const item = items[0];
		expect(item.acronym).toBe('CONF 2026');
		expect(item.series).toBe('CONF');
		expect(item.fullName).toContain('Test Conference');
		expect(item.location).toBe('Paris, France');
		expect(item.start).toBe('2026-06-01 -- 2026-06-03');
		// deadlineFromTimeline should pick the last valid deadline "2026-02-01"
		expect(item.submissionDdl).toBe('2026-02-01');
		expect(item.source).toBe('ccfddl');
		expect(item.url).toBe('https://example.org/conf2026');
	});

	it('skips empty URLs and non-200 responses', async () => {
		// First call: non-200 → ignored
		(requestUrl as jest.Mock).mockResolvedValueOnce({ status: 404, text: '' });

		const items = await fetchCcfddl(['', 'https://bad.example.com']);

		expect(items).toHaveLength(0);
		// Only one non-empty URL should be requested
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});
});

