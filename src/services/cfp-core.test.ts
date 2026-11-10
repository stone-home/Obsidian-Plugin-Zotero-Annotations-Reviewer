import {
	CoreCsvEntry,
	CoreRankIndex,
	getCoreRankForSeries,
	parseCoreCsv,
} from './cfp-core';

const HEADER = 'id,Conference name,Acronym,Collection,Rank,Primary FoR';

function csv(...rows: string[]): string {
	return rows.join('\n');
}

function indexOf(entries: Partial<CoreCsvEntry>[], key = 'X'): CoreRankIndex {
	return {
		byAcronym: new Map([[key, entries as CoreCsvEntry[]]]),
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

		const entry = {
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

	it('skips malformed rows with fewer than five columns', () => {
		const index = parseCoreCsv(
			csv('1,Too Short,TS,ICORE2026', 'garbage', '2,Good Conf,GC,ICORE2026,C')
		);

		expect([...index.byAcronym.keys()]).toEqual(['GC']);
	});

	it('skips rows with neither name nor acronym', () => {
		const index = parseCoreCsv(csv('1,,,ICORE2026,A', '2, ,  ,ICORE2026,B'));

		expect(index.byAcronym.size).toBe(0);
		expect(index.byName.size).toBe(0);
	});

	it('supports quoted fields with commas and escaped quotes', () => {
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
	});

	it('treats commas inside an unterminated quote as part of the cell', () => {
		const index = parseCoreCsv('9,"Broken, Conf,BC,ICORE2026,B');

		expect(index.byAcronym.size).toBe(0);
	});

	it('falls back to the name for the acronym key and vice versa', () => {
		const index = parseCoreCsv(
			csv('1,Name Only Conf,,ICORE2026,A', '2,,AO-23,ICORE2026,B')
		);

		expect(index.byAcronym.has('NAMEONLYCONF')).toBe(true);
		expect(index.byName.has('name only conf')).toBe(true);
		expect(index.byAcronym.has('AO-23')).toBe(true);
		expect(index.byName.has('ao 23')).toBe(true);
	});

	it('normalises acronym whitespace and case, and name punctuation', () => {
		const index = parseCoreCsv(
			'1,"ACM/IEEE  Conf. on   Things (CoT)",Usenix  atc,ICORE2026,A'
		);

		expect([...index.byAcronym.keys()]).toEqual(['USENIXATC']);
		expect([...index.byName.keys()]).toEqual(['acm ieee conf on things cot']);
	});

	it('groups rows sharing an acronym or a name in file order', () => {
		const index = parseCoreCsv(
			csv(
				'1,Conf Alpha,DUP,CORE2023,B',
				'2,Conf Beta,dup,ICORE2026,A',
				'3,Conf Alpha,OTHER,ICORE2026,C'
			)
		);

		expect(index.byAcronym.get('DUP')!.map((e) => e.collection)).toEqual([
			'CORE2023',
			'ICORE2026',
		]);
		expect(index.byName.get('conf alpha')!.map((e) => e.acronym)).toEqual([
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

	it('returns null for empty, blank or missing series names', () => {
		expect(getCoreRankForSeries(index, '')).toBeNull();
		expect(getCoreRankForSeries(index, '   ')).toBeNull();
		expect(getCoreRankForSeries(index, undefined as unknown as string)).toBeNull();
		expect(getCoreRankForSeries(index, null as unknown as string)).toBeNull();
	});

	it('returns null when nothing matches', () => {
		expect(getCoreRankForSeries(index, 'NOPE')).toBeNull();
		expect(getCoreRankForSeries(parseCoreCsv(''), 'AAAI')).toBeNull();
	});

	it('looks up by acronym', () => {
		expect(getCoreRankForSeries(index, 'AAAI')).toEqual({
			coreLetter: 'A*',
			collection: 'ICORE2026',
		});
	});

	it('ignores case and whitespace differences in the acronym', () => {
		expect(getCoreRankForSeries(index, '  aaai ')?.coreLetter).toBe('A*');
		expect(getCoreRankForSeries(index, 'usenix atc')?.coreLetter).toBe('A');
		expect(getCoreRankForSeries(index, 'UsenixATC')?.coreLetter).toBe('A');
		expect(getCoreRankForSeries(index, 'LC')?.coreLetter).toBe('C');
	});

	it('strips a trailing year', () => {
		expect(getCoreRankForSeries(index, 'AAAI 2026')?.coreLetter).toBe('A*');
		expect(getCoreRankForSeries(index, 'USENIX ATC 1999')?.coreLetter).toBe('A');
	});

	it('does not strip a year that is glued to the acronym', () => {
		expect(getCoreRankForSeries(index, 'AAAI2026')).toBeNull();
		expect(getCoreRankForSeries(index, "AAAI'26")).toBeNull();
	});

	it('falls back to the full name with case and punctuation differences', () => {
		expect(
			getCoreRankForSeries(index, 'International Conference on Machine Learning')
		).toEqual({
			coreLetter: 'A*',
			collection: 'ICORE2026',
		});
		expect(
			getCoreRankForSeries(
				index,
				'international  conference on machine-learning 2025'
			)?.coreLetter
		).toBe('A*');
	});

	it('normalises lower-case rank letters', () => {
		expect(getCoreRankForSeries(index, 'ICML')?.coreLetter).toBe('A*');
		expect(getCoreRankForSeries(index, 'lc')).toEqual({
			coreLetter: 'C',
			collection: 'ICORE2026',
		});
	});

	it('prefers the first candidate carrying a letter grade', () => {
		expect(getCoreRankForSeries(index, 'MRC')).toEqual({
			coreLetter: 'B',
			collection: 'ICORE2026',
		});
	});

	it('reports the raw status of the first candidate when none has a letter', () => {
		expect(getCoreRankForSeries(index, 'NLC')).toEqual({
			coreLetter: undefined,
			collection: 'CORE2021',
			coreStatus: 'National: USA',
		});
		expect(getCoreRankForSeries(index, 'WOT')).toEqual({
			coreLetter: undefined,
			collection: 'ICORE2026',
			coreStatus: 'Unranked',
		});
	});

	it('omits status and collection when both are blank', () => {
		const result = getCoreRankForSeries(index, 'BRC');

		expect(result).toEqual({ coreLetter: undefined, collection: undefined });
		expect(result).not.toHaveProperty('coreStatus');
	});

	it('tolerates hand-built entries with missing or padded ranks', () => {
		expect(
			getCoreRankForSeries(
				indexOf([{ name: 'X', acronym: 'X', collection: 'C1' }]),
				'X'
			)
		).toEqual({
			coreLetter: undefined,
			collection: 'C1',
		});
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
	});

	it('uses the name index when the acronym bucket is empty', () => {
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
		expect(
			getCoreRankForSeries(
				{ byAcronym: new Map([['X', []]]), byName: new Map() },
				'X'
			)
		).toBeNull();
	});
});
