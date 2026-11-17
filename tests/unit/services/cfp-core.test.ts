import {
	CoreCsvEntry,
	CoreRankIndex,
	getCoreRankForSeries,
	parseCoreCsv,
} from '../../../src/services/cfp-core';

const HEADER = 'id,Conference name,Acronym,Collection,Rank,Primary FoR';

function csv(...rows: string[]): string {
	return rows.join('\n');
}

function indexOf(entries: Array<Partial<CoreCsvEntry>>, key = 'X'): CoreRankIndex {
	const normalized: CoreCsvEntry[] = entries.map((e) => ({
		name: e.name ?? '',
		acronym: e.acronym ?? '',
		collection: e.collection ?? '',
		rankRaw: e.rankRaw ?? '',
	}));
	return {
		byAcronym: new Map([[key, normalized]]),
		byName: new Map(),
	};
}

describe('parseCoreCsv', () => {
	it('returns empty maps for empty or blank input', () => {
		for (const text of ['', '\n\n', '   \n\t\n']) {
			const index = parseCoreCsv(text);
			expect(index.byAcronym.size).toBe(0);
			expect(index.byName.size).toBe(0);
		}
	});

	it('indexes a row by normalised acronym and name', () => {
		const index = parseCoreCsv(
			'42,International Conference on Machine Learning,ICML,ICORE2026,A*,4611'
		);

		const entry: CoreCsvEntry = {
			name: 'International Conference on Machine Learning',
			acronym: 'ICML',
			collection: 'ICORE2026',
			rankRaw: 'A*',
		};
		expect([...index.byAcronym.keys()]).toEqual(['ICML']);
		expect([...index.byName.keys()]).toEqual([
			'international conference on machine learning',
		]);
		expect(index.byAcronym.get('ICML')).toEqual([entry]);
		expect(
			index.byName.get('international conference on machine learning')
		).toEqual([entry]);
	});

	it('skips the header row', () => {
		const index = parseCoreCsv(csv(HEADER, '1,Some Conference,SC,ICORE2026,A'));

		expect(index.byAcronym.size).toBe(1);
		expect(index.byAcronym.has('SC')).toBe(true);
		expect(index.byAcronym.has('ACRONYM')).toBe(false);
	});

	it('keeps a header-like row when only one of the two header cells matches', () => {
		const index = parseCoreCsv(
			csv('id,Title,T1,C1,A', '7,Conference on Tests,T2,C2,B')
		);

		expect(index.byAcronym.has('T1')).toBe(true);
		expect(index.byAcronym.has('T2')).toBe(true);
	});

	it('handles CRLF line endings and surrounding whitespace', () => {
		const index = parseCoreCsv(
			'  1, Conf One , c1 , ICORE2026 , a \r\n\r\n2,Conf Two,C2,ICORE2026,B\r\n'
		);

		expect(index.byAcronym.get('C1')).toEqual([
			{ name: 'Conf One', acronym: 'c1', collection: 'ICORE2026', rankRaw: 'a' },
		]);
		expect(index.byAcronym.has('C2')).toBe(true);
	});

	it('skips malformed rows with fewer than five columns or neither name nor acronym', () => {
		const shortRows = parseCoreCsv(
			csv('1,Too Short,TS,ICORE2026', 'garbage', '2,Good Conf,GC,ICORE2026,C')
		);
		expect([...shortRows.byAcronym.keys()]).toEqual(['GC']);

		const blankRows = parseCoreCsv(csv('1,,,ICORE2026,A', '2, ,  ,ICORE2026,B'));
		expect(blankRows.byAcronym.size).toBe(0);
		expect(blankRows.byName.size).toBe(0);
	});

	it('supports quoted fields with commas, escaped quotes, and unterminated quotes', () => {
		const index = parseCoreCsv(
			'9,"Data, Knowledge and ""Smart"" Systems","DKS",ICORE2026,B'
		);

		expect(index.byAcronym.get('DKS')).toEqual([
			{
				name: 'Data, Knowledge and "Smart" Systems',
				acronym: 'DKS',
				collection: 'ICORE2026',
				rankRaw: 'B',
			},
		]);
		expect(index.byName.has('data knowledge and smart systems')).toBe(true);

		const broken = parseCoreCsv('9,"Broken, Conf,BC,ICORE2026,B');
		expect(broken.byAcronym.size).toBe(0);
	});

	it('falls back between name and acronym keys and groups duplicates in file order', () => {
		const fallback = parseCoreCsv(
			csv('1,Name Only Conf,,ICORE2026,A', '2,,AO-23,ICORE2026,B')
		);
		expect(fallback.byAcronym.has('NAMEONLYCONF')).toBe(true);
		expect(fallback.byName.has('name only conf')).toBe(true);
		expect(fallback.byAcronym.has('AO-23')).toBe(true);
		expect(fallback.byName.has('ao 23')).toBe(true);

		const grouped = parseCoreCsv(
			csv(
				'1,Conf Alpha,DUP,CORE2023,B',
				'2,Conf Beta,dup,ICORE2026,A',
				'3,Conf Alpha,OTHER,ICORE2026,C'
			)
		);
		expect(grouped.byAcronym.get('DUP')?.map((e) => e.collection)).toEqual([
			'CORE2023',
			'ICORE2026',
		]);
		expect(grouped.byName.get('conf alpha')?.map((e) => e.acronym)).toEqual([
			'DUP',
			'OTHER',
		]);
	});
});

describe('getCoreRankForSeries', () => {
	const index = parseCoreCsv(
		csv(
			HEADER,
			'1,AAAI Conference on Artificial Intelligence,AAAI,ICORE2026,A*',
			'2,International Conference on Machine Learning,ICML,ICORE2026,a*',
			'3,USENIX Annual Technical Conference,USENIX ATC,ICORE2026,A',
			'4,Workshop on Things,WOT,ICORE2026,Unranked',
			'5,Multi Rank Conf,MRC,CORE2021,journal published',
			'6,Multi Rank Conf,MRC,ICORE2026,B',
			'7,No Letter Conf,NLC,CORE2021,National: USA',
			'8,No Letter Conf,NLC,ICORE2026,Unranked',
			'9,Blank Rank Conf,BRC,,',
			'10,Lower Conf,lc,ICORE2026,c'
		)
	);

	it('returns null for empty, blank, missing, or unmatched series names', () => {
		expect(getCoreRankForSeries(index, '')).toBeNull();
		expect(getCoreRankForSeries(index, '   ')).toBeNull();
		// @ts-expect-error testing runtime guard against undefined input
		expect(getCoreRankForSeries(index, undefined)).toBeNull();
		expect(getCoreRankForSeries(index, 'NOPE')).toBeNull();
		expect(getCoreRankForSeries(parseCoreCsv(''), 'AAAI')).toBeNull();
	});

	it('looks up by acronym ignoring case, whitespace, and trailing year', () => {
		expect(getCoreRankForSeries(index, 'AAAI')).toEqual({
			coreLetter: 'A*',
			collection: 'ICORE2026',
		});
		expect(getCoreRankForSeries(index, '  aaai ')?.coreLetter).toBe('A*');
		expect(getCoreRankForSeries(index, 'usenix atc')?.coreLetter).toBe('A');
		expect(getCoreRankForSeries(index, 'UsenixATC')?.coreLetter).toBe('A');
		expect(getCoreRankForSeries(index, 'LC')?.coreLetter).toBe('C');
		expect(getCoreRankForSeries(index, 'AAAI 2026')?.coreLetter).toBe('A*');
		expect(getCoreRankForSeries(index, 'AAAI   2026')?.coreLetter).toBe('A*');
		expect(getCoreRankForSeries(index, 'USENIX ATC 1999')?.coreLetter).toBe('A');
		expect(getCoreRankForSeries(index, 'AAAI2026')).toBeNull();
	});

	it('does not strip mid-title years and completes in linear time on long whitespace', () => {
		const midYearIndex = parseCoreCsv(
			csv(HEADER, '11,IEEE 2020 Vision Workshop,,ICORE2026,B')
		);
		expect(getCoreRankForSeries(midYearIndex, 'IEEE 2020 Vision Workshop')).toEqual(
			{
				coreLetter: 'B',
				collection: 'ICORE2026',
			}
		);
		expect(
			getCoreRankForSeries(midYearIndex, 'IEEE 2020 Vision Workshop 2026')
		).toEqual({
			coreLetter: 'B',
			collection: 'ICORE2026',
		});
		expect(getCoreRankForSeries(midYearIndex, 'IEEE Vision Workshop')).toBeNull();

		const adversarial = 'A' + ' '.repeat(50000) + 'X';
		const start = performance.now();
		const result = getCoreRankForSeries(index, adversarial);
		const elapsed = performance.now() - start;
		expect(result).toBeNull();
		expect(elapsed).toBeLessThan(100);
	});

	it('falls back to full conference name and prefers letter grades over raw status', () => {
		expect(
			getCoreRankForSeries(
				index,
				'international  conference on machine-learning 2025'
			)
		).toEqual({
			coreLetter: 'A*',
			collection: 'ICORE2026',
		});
		expect(getCoreRankForSeries(index, 'MRC')).toEqual({
			coreLetter: 'B',
			collection: 'ICORE2026',
		});
		expect(getCoreRankForSeries(index, 'NLC')).toEqual({
			coreLetter: undefined,
			collection: 'CORE2021',
			coreStatus: 'National: USA',
		});
		expect(getCoreRankForSeries(index, 'BRC')).toEqual({
			coreLetter: undefined,
			collection: undefined,
		});
	});

	it('tolerates hand-built entries and empty acronym buckets', () => {
		expect(
			getCoreRankForSeries(
				indexOf([
					{ rankRaw: '   ', collection: '' },
					{ rankRaw: ' b ', collection: 'C2' },
				]),
				'X'
			)
		).toEqual({
			coreLetter: 'B',
			collection: 'C2',
		});

		const custom: CoreRankIndex = {
			byAcronym: new Map([['X', []]]),
			byName: new Map([
				['x', [{ name: 'X', acronym: '', collection: 'C3', rankRaw: 'A' }]],
			]),
		};
		expect(getCoreRankForSeries(custom, 'X')).toEqual({
			coreLetter: 'A',
			collection: 'C3',
		});
	});
});
