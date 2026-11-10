import { importIncoming, importJsonl, ingest, validateInput } from './digest-import';
import { DigestStore } from './digest-store';
import { DigestFiles } from './digest-types';

function memoryFiles(initial: Record<string, string> = {}) {
	const data = new Map<string, string>(Object.entries(initial));
	const folders = new Set<string>();
	const files: DigestFiles = {
		exists: async (path) =>
			data.has(path) ||
			folders.has(path) ||
			Array.from(data.keys()).some((key) => key.startsWith(`${path}/`)),
		read: async (path) => data.get(path) as string,
		write: async (path, text) => void data.set(path, text),
		remove: async (path) => void data.delete(path),
		list: async (folder) =>
			Array.from(data.keys()).filter((path) => path.startsWith(`${folder}/`)),
		mkdir: async (folder) => void folders.add(folder),
	};
	return { data, folders, files };
}

async function newStore(files: DigestFiles): Promise<DigestStore> {
	const store = new DigestStore(files, 'plugin/digest-store.json');
	await store.load();
	return store;
}

describe('validateInput', () => {
	const valid = {
		key: '10.48550/arXiv.2401.12345',
		title: 'Paper',
		doi: '10.48550/arXiv.2401.12345',
		url: 'https://arxiv.org/abs/2401.12345',
		year: 2024,
		venue: 'arXiv',
		abstract: 'Text',
		item_type: 'preprint',
	};

	it('accepts a complete paper unchanged', () => {
		expect(validateInput(valid)).toEqual({ ok: true, input: valid });
	});

	it('accepts the two required fields alone and trims them', () => {
		expect(validateInput({ key: ' k ', title: ' T ' })).toEqual({
			ok: true,
			input: { key: 'k', title: 'T' },
		});
	});

	it('drops empty and null optional values', () => {
		expect(
			validateInput({
				key: 'k',
				title: 'T',
				doi: '',
				url: null,
				year: null,
				venue: '',
				abstract: null,
			})
		).toEqual({ ok: true, input: { key: 'k', title: 'T' } });
	});

	it.each([
		['a string', 'text', 'Not a JSON object'],
		['null', null, 'Not a JSON object'],
		['an array', [], 'Not a JSON object'],
		['a missing key', { title: 'T' }, 'Missing key'],
		['a blank key', { key: '  ', title: 'T' }, 'Missing key'],
		['a missing title', { key: 'k' }, 'Missing title'],
		['a numeric title', { key: 'k', title: 3 }, 'Missing title'],
		[
			'a DOI with a URL prefix',
			{ key: 'k', title: 'T', doi: 'https://doi.org/10.1000/a' },
			'doi is not a bare DOI (10.xxxx/...)',
		],
		[
			'a numeric DOI',
			{ key: 'k', title: 'T', doi: 10 },
			'doi is not a bare DOI (10.xxxx/...)',
		],
		[
			'a relative URL',
			{ key: 'k', title: 'T', url: 'arxiv.org/abs/1' },
			'url is not an absolute http(s) URL',
		],
		[
			'a string year',
			{ key: 'k', title: 'T', year: '2024' },
			'year is not an integer',
		],
		[
			'a fractional year',
			{ key: 'k', title: 'T', year: 2024.5 },
			'year is not an integer',
		],
		[
			'a numeric venue',
			{ key: 'k', title: 'T', venue: 1 },
			'venue is not a string',
		],
		[
			'a list abstract',
			{ key: 'k', title: 'T', abstract: [] },
			'abstract is not a string',
		],
	])('rejects %s', (_name, candidate, reason) => {
		expect(validateInput(candidate)).toEqual({ ok: false, reason });
	});
});

describe('ingest', () => {
	it('adds new papers under a batch and counts duplicates', async () => {
		const store = await newStore(memoryFiles().files);
		store.add({ key: 'a', title: 'A' });

		const result = ingest(
			store,
			[
				{ key: 'A', title: 'A again' },
				{ key: 'b', title: 'B' },
			],
			'bib-x'
		);

		expect(result).toEqual({ added: 1, duplicates: 1 });
		expect(store.get('b')?.batch).toBe('bib-x');
	});
});

describe('importJsonl', () => {
	it('adds valid lines, skips duplicates and keeps invalid lines', async () => {
		const store = await newStore(memoryFiles().files);
		const text = [
			JSON.stringify({ key: '10.1000/a', title: 'A', doi: '10.1000/a' }),
			'',
			JSON.stringify({
				key: 'https://x.org/a',
				title: 'Same DOI',
				doi: '10.1000/A',
			}),
			'{not json',
			JSON.stringify({ key: 'k', title: 'T', year: 'soon' }),
			'   ',
		].join('\r\n');

		expect(importJsonl(store, text, 'run.jsonl')).toEqual({
			added: 1,
			duplicates: 1,
			invalid: 2,
		});
		expect(store.invalidLines().map((line) => [line.reason, line.file])).toEqual([
			['Not valid JSON', 'run.jsonl'],
			['year is not an integer', 'run.jsonl'],
		]);
		expect(store.invalidLines()[0].raw).toBe('{not json');
	});
});

describe('importIncoming', () => {
	it('creates the folder and imports nothing when it does not exist', async () => {
		const { files, folders } = memoryFiles();
		const store = await newStore(files);

		expect(await importIncoming(files, store, 'Digest/Incoming')).toEqual({
			files: 0,
			added: 0,
			duplicates: 0,
			invalid: 0,
		});
		expect(folders.has('Digest/Incoming')).toBe(true);
	});

	it('imports every jsonl file, saves, then removes it', async () => {
		const { files, data } = memoryFiles({
			'in/b.JSONL': JSON.stringify({ key: 'b', title: 'B' }),
			'in/a.jsonl': [
				JSON.stringify({ key: 'a', title: 'A' }),
				JSON.stringify({ key: 'b', title: 'B first' }),
				'broken',
			].join('\n'),
			'in/pending.tmp': 'half written',
			'in/notes.md': '# not data',
		});
		const store = await newStore(files);

		const summary = await importIncoming(files, store, 'in');

		expect(summary).toEqual({ files: 2, added: 2, duplicates: 1, invalid: 1 });
		expect(store.get('b')?.title).toBe('B first');
		expect(store.invalidLines()[0].file).toBe('a.jsonl');
		expect(data.has('in/a.jsonl')).toBe(false);
		expect(data.has('in/b.JSONL')).toBe(false);
		expect(data.has('in/pending.tmp')).toBe(true);
		expect(data.has('in/notes.md')).toBe(true);
		expect(
			JSON.parse(data.get('plugin/digest-store.json') as string).records.a.title
		).toBe('A');
	});

	it('absorbs a repeated import of the same file', async () => {
		const line = JSON.stringify({ key: 'a', title: 'A' });
		const { files, data } = memoryFiles({ 'in/a.jsonl': line });
		const store = await newStore(files);
		await importIncoming(files, store, 'in');
		data.set('in/a.jsonl', line);

		expect(await importIncoming(files, store, 'in')).toEqual({
			files: 1,
			added: 0,
			duplicates: 1,
			invalid: 0,
		});
		expect(store.counts().unchecked).toBe(1);
	});

	it('keeps the file when saving the store fails', async () => {
		const { files, data } = memoryFiles({
			'in/a.jsonl': JSON.stringify({ key: 'a', title: 'A' }),
		});
		const store = await newStore(files);
		files.write = async () => {
			throw new Error('disk full');
		};

		await expect(importIncoming(files, store, 'in')).rejects.toThrow('disk full');
		expect(data.has('in/a.jsonl')).toBe(true);
	});
});
