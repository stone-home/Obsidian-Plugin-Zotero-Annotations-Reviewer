import {
	bibEntryToInput,
	bibToInputs,
	cleanLatex,
	parseBibEntries,
} from './digest-bib';

describe('parseBibEntries', () => {
	it('reads braced, quoted, bare and concatenated values', () => {
		const entries = parseBibEntries(`
@Article{smith2024,
	Title = {A {Nested {Brace}} Title},
	journal = "Journal of {T}ests",
	year = 2024,
	note = "part one" # { and two},
	pages = {1--10}
}`);

		expect(entries).toEqual([
			{
				type: 'article',
				citekey: 'smith2024',
				fields: {
					title: 'A {Nested {Brace}} Title',
					journal: 'Journal of {T}ests',
					year: '2024',
					note: 'part one and two',
					pages: '1--10',
				},
			},
		]);
	});

	it('ignores comment, string and preamble blocks and text between entries', () => {
		const entries = parseBibEntries(`
% a comment line
@comment{ignored, title={x}}
@string{jt = "Journal"}
@preamble{"\\newcommand{\\x}{y}"}
free text
@misc{only, title={Kept}}`);

		expect(entries.map((entry) => entry.citekey)).toEqual(['only']);
	});

	it('skips an entry without fields and survives an unterminated entry', () => {
		expect(parseBibEntries('@misc{nokey}')).toEqual([]);
		expect(parseBibEntries('@misc{open, title={Never closed')[0].citekey).toBe(
			'open'
		);
		expect(parseBibEntries('')).toEqual([]);
	});

	it('handles escaped characters and quotes inside braces', () => {
		const [entry] = parseBibEntries(
			'@misc{k, title="He said {"hi"} \\" there", author={A \\} B}, junk here, url={https://x.org}}'
		);

		expect(entry.fields.title).toBe('He said {"hi"} \\" there');
		expect(entry.fields.author).toBe('A \\} B');
		expect(entry.fields.url).toBe('https://x.org');
	});
});

describe('cleanLatex', () => {
	it.each([
		['{Attention} Is All You {N}eed', 'Attention Is All You Need'],
		["Caf\\'{e} \\& Co", 'Cafe & Co'],
		['Schr\\"odinger', 'Schrodinger'],
		['\\textbf{Bold} and \\emph{soft}', 'Bold and soft'],
		['50\\% of \\$10', '50% of $10'],
		['A~B   C\n D', 'A B C D'],
		['\\LaTeX rules', 'rules'],
	])('cleans %s', (input, expected) => {
		expect(cleanLatex(input)).toBe(expected);
	});
});

describe('bibEntryToInput', () => {
	const entry = (type: string, fields: Record<string, string>, citekey = 'key') => ({
		type,
		citekey,
		fields,
	});

	it('uses the DOI as key and strips its URL prefix', () => {
		expect(
			bibEntryToInput(
				entry('inproceedings', {
					title: 'A {Paper}',
					doi: 'https://doi.org/10.1145/123.456',
					url: 'https://dl.acm.org/x',
					booktitle: 'Proc. {X}',
					year: '2020',
					abstract: 'An  abstract.',
				})
			)
		).toEqual({
			key: '10.1145/123.456',
			title: 'A Paper',
			doi: '10.1145/123.456',
			url: 'https://dl.acm.org/x',
			year: 2020,
			venue: 'Proc. X',
			abstract: 'An abstract.',
			item_type: 'conferencePaper',
		});
	});

	it('strips the dx.doi.org and doi: prefixes', () => {
		expect(
			bibEntryToInput(
				entry('article', { title: 'T', doi: 'http://dx.doi.org/10.1000/a' })
			)?.doi
		).toBe('10.1000/a');
		expect(
			bibEntryToInput(entry('article', { title: 'T', doi: 'doi: 10.1000/b' }))
				?.doi
		).toBe('10.1000/b');
	});

	it('derives the arXiv DOI and URL from eprint, without the version', () => {
		expect(
			bibEntryToInput(
				entry('article', {
					title: 'T',
					eprint: 'arXiv:1706.03762v5',
					archiveprefix: 'arXiv',
					journal: 'arXiv preprint',
				})
			)
		).toEqual({
			key: '10.48550/arXiv.1706.03762',
			title: 'T',
			doi: '10.48550/arXiv.1706.03762',
			url: 'https://arxiv.org/abs/1706.03762',
			venue: 'arXiv preprint',
			item_type: 'preprint',
		});
	});

	it('accepts eprinttype and prefers an explicit DOI over the arXiv one', () => {
		const input = bibEntryToInput(
			entry('article', {
				title: 'T',
				eprint: '2401.00001',
				eprinttype: 'arxiv',
				doi: '10.1000/journal',
			})
		);

		expect(input?.doi).toBe('10.1000/journal');
		expect(input?.item_type).toBe('journalArticle');
		expect(input?.url).toBe('https://arxiv.org/abs/2401.00001');
	});

	it('ignores eprint from another archive or an empty arXiv id', () => {
		expect(
			bibEntryToInput(
				entry('misc', { title: 'T', eprint: '123', archiveprefix: 'hal' })
			)
		).toBeUndefined();
		expect(
			bibEntryToInput(
				entry('misc', { title: 'T', eprint: 'arXiv:', archiveprefix: 'arXiv' })
			)
		).toBeUndefined();
	});

	it('falls back to the URL as key and to the citekey as title', () => {
		expect(
			bibEntryToInput(entry('misc', { url: ' https://x.org/p ' }, 'cite1'))
		).toEqual({
			key: 'https://x.org/p',
			title: 'cite1',
			url: 'https://x.org/p',
			item_type: 'document',
		});
	});

	it.each([
		['book', 'book'],
		['incollection', 'bookSection'],
		['phdthesis', 'thesis'],
		['techreport', 'report'],
		['conference', 'conferencePaper'],
		['unpublished', 'document'],
	])('maps @%s to %s', (type, itemType) => {
		expect(
			bibEntryToInput(entry(type, { title: 'T', doi: '10.1000/a' }))?.item_type
		).toBe(itemType);
	});

	it('returns undefined without an identifier or with one that fails validation', () => {
		expect(bibEntryToInput(entry('misc', { title: 'No id' }))).toBeUndefined();
		expect(
			bibEntryToInput(entry('misc', { title: 'T', doi: 'not-a-doi' }))
		).toBeUndefined();
	});

	it('ignores a year that is not a number', () => {
		expect(
			bibEntryToInput(
				entry('article', { title: 'T', doi: '10.1000/a', year: 'in press' })
			)
		).not.toHaveProperty('year');
	});
});

describe('bibToInputs', () => {
	it('converts entries and counts the skipped ones', () => {
		const result = bibToInputs(`
@article{a, title={A}, doi={10.1000/a}, year={2021}}
@misc{b, title={B}}
@misc{c, title={C}, url={https://x.org/c}}`);

		expect(result.skipped).toBe(1);
		expect(result.inputs.map((input) => input.key)).toEqual([
			'10.1000/a',
			'https://x.org/c',
		]);
	});
});
