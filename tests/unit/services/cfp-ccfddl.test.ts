import {
	fetchCcfddl,
	getCcfRankForSeriesTitle,
	parseCcfddlYaml,
} from '../../../src/services/cfp-ccfddl';
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

describe('cfp-ccfddl', () => {
	beforeEach(() => {
		resetObsidianMocks();
		parseCcfddlYaml('[]');
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('parseCcfddlYaml & getCcfRankForSeriesTitle', () => {
		it('parses real YAML entries, timeline deadlines, and series rank metadata', () => {
			const yamlText = [
				'- title: CONF',
				'  description: Test Conference on Something',
				'  sub: AI',
				'  rank:',
				'    ccf: A',
				'    thcpl: B',
				'  confs:',
				'    - year: 2026',
				'      link: https://example.org/conf2026',
				'      date: 2026-06-01 -- 2026-06-03',
				'      place: Paris, France',
				'      timeline:',
				'        - abstract_deadline: "2026-01-10"',
				'          deadline: TBD',
				'        - deadline: "2026-02-01"',
				'- title: ABST',
				'  confs:',
				'    - timeline:',
				'        - abstract_deadline: "2026-03-15"',
			].join('\n');

			const items = parseCcfddlYaml(yamlText);

			expect(items).toHaveLength(2);
			expect(items[0]).toEqual({
				acronym: 'CONF 2026',
				series: 'CONF',
				fullName: 'Test Conference on Something',
				location: 'Paris, France',
				start: '2026-06-01 -- 2026-06-03',
				end: undefined,
				submissionDdl: '2026-02-01',
				source: 'ccfddl',
				url: 'https://example.org/conf2026',
			});
			expect(items[1]).toMatchObject({
				acronym: 'ABST',
				series: 'ABST',
				fullName: 'ABST',
				location: 'N/A',
				submissionDdl: '2026-03-15',
			});
			expect(getCcfRankForSeriesTitle('CONF')).toEqual({
				ccf: 'A',
				thcpl: 'B',
				sub: 'AI',
			});
			expect(getCcfRankForSeriesTitle('ABST')).toBeUndefined();
		});

		it('handles non-object rank values (string, number, null) and null rank subfields safely', () => {
			const yamlText = [
				'- title: STR_RANK',
				'  rank: "A"',
				'  sub: SE',
				'  confs:',
				'    - year: 2026',
				'- title: NULL_RANK',
				'  rank: null',
				'  confs:',
				'    - year: 2026',
				'- title: PARTIAL_RANK',
				'  rank:',
				'    ccf: null',
				'    thcpl: A',
				'  confs:',
				'    - year: 2026',
				'- title: ""',
				'  confs:',
				'    - year: 2026',
			].join('\n');

			const items = parseCcfddlYaml(yamlText);
			expect(items.map((i) => i.acronym)).toEqual([
				'STR_RANK 2026',
				'NULL_RANK 2026',
				'PARTIAL_RANK 2026',
			]);
			expect(getCcfRankForSeriesTitle('STR_RANK')).toEqual({
				ccf: undefined,
				thcpl: undefined,
				sub: 'SE',
			});
			expect(getCcfRankForSeriesTitle('NULL_RANK')).toBeUndefined();
			expect(getCcfRankForSeriesTitle('PARTIAL_RANK')).toEqual({
				ccf: undefined,
				thcpl: 'A',
				sub: undefined,
			});
		});

		it('returns empty array for invalid or non-array YAML documents', () => {
			expect(parseCcfddlYaml(': [unclosed yaml')).toEqual([]);
			expect(parseCcfddlYaml('not_an_array: true')).toEqual([]);
		});
	});

	describe('fetchCcfddl', () => {
		it('fetches multiple URLs with delay, skips empty/failed/non-200 URLs, and maps TBD deadlines to N/A', async () => {
			jest.useFakeTimers();
			const yaml1 = [
				'- title: CONF',
				'  confs:',
				'    - year: 2027',
				'      timeline:',
				'        - deadline: TBD',
				'          abstract_deadline: TBD',
			].join('\n');

			requestUrl
				.mockResolvedValueOnce(makeResponse(200, yaml1))
				.mockResolvedValueOnce(makeResponse(404, ''))
				.mockRejectedValueOnce(new Error('network error'));

			const promise = fetchCcfddl([
				'https://u1.example.org/allconf.yml',
				'   ',
				'https://u2.example.org/missing.yml',
				'https://u3.example.org/offline.yml',
			]);
			await jest.runAllTimersAsync();
			const items = await promise;

			expect(requestUrl).toHaveBeenCalledTimes(3);
			expect(items).toHaveLength(1);
			expect(items[0].submissionDdl).toBe('N/A');
		});
	});
});
