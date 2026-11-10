import { DigestStore, normaliseId } from './digest-store';
import {
	DEFAULT_DIGEST_SETTINGS,
	DigestFiles,
	activeVocab,
	toVocabId,
	getHeader,
	resolveDigestSettings,
} from './digest-types';

const STORE_PATH = 'plugin/digest-store.json';

function memoryFiles(initial: Record<string, string> = {}) {
	const data = new Map<string, string>(Object.entries(initial));
	const files: DigestFiles = {
		exists: async (path) => data.has(path),
		read: async (path) => data.get(path) as string,
		write: async (path, text) => void data.set(path, text),
		remove: async (path) => void data.delete(path),
		list: async (folder) =>
			Array.from(data.keys()).filter((path) => path.startsWith(`${folder}/`)),
		mkdir: async () => undefined,
	};
	return { data, files };
}

describe('DigestStore', () => {
	let now: Date;
	let files: DigestFiles;
	let data: Map<string, string>;
	let store: DigestStore;

	beforeEach(async () => {
		now = new Date('2026-11-01T00:00:00Z');
		({ files, data } = memoryFiles());
		store = new DigestStore(files, STORE_PATH, () => now);
		await store.load();
	});

	it('starts empty when the file does not exist', () => {
		expect(store.counts()).toEqual({ unchecked: 0, accepted: 0, rejected: 0 });
		expect(store.list('unchecked')).toEqual([]);
		expect(store.invalidLines()).toEqual([]);
	});

	it('adds a paper as unchecked with a timestamp and optional batch', () => {
		expect(store.add({ key: 'K1', title: 'One' })).toBe(true);
		expect(store.add({ key: 'K2', title: 'Two' }, 'bib-a')).toBe(true);

		expect(store.get('k1')).toEqual({
			key: 'K1',
			title: 'One',
			status: 'unchecked',
			added_at: '2026-11-01T00:00:00.000Z',
		});
		expect(store.get('K2')?.batch).toBe('bib-a');
	});

	it('rejects a duplicate key regardless of case and state', () => {
		store.add({ key: '10.1000/Abc', title: 'One' });
		store.reject('10.1000/abc', 'off-topic');

		expect(store.add({ key: ' 10.1000/ABC ', title: 'Again' })).toBe(false);
		expect(store.counts().rejected).toBe(1);
	});

	it('rejects a duplicate DOI stored under a different key', () => {
		store.add({ key: 'https://a.org/p', title: 'One', doi: '10.1000/Abc' });

		expect(
			store.findDuplicate({ key: 'other', title: 'x', doi: '10.1000/ABC' })?.key
		).toBe('https://a.org/p');
		expect(store.add({ key: 'other', title: 'x', doi: '10.1000/abc' })).toBe(false);
		expect(store.findDuplicate({ key: 'new', title: 'x' })).toBeUndefined();
		expect(
			store.findDuplicate({ key: 'new', title: 'x', doi: '10.1000/zzz' })
		).toBeUndefined();
	});

	it('lists a state oldest first', () => {
		store.add({ key: 'b', title: 'B' });
		now = new Date('2026-11-02T00:00:00Z');
		store.add({ key: 'a', title: 'A' });

		expect(store.list('unchecked').map((record) => record.key)).toEqual(['b', 'a']);
	});

	it('records a rejection and an acceptance', () => {
		store.add({ key: 'r', title: 'R' });
		store.add({ key: 'a', title: 'A' });
		now = new Date('2026-11-03T00:00:00Z');

		store.reject('r', 'too-old');
		store.accept('a', {
			directions: ['llm'],
			collections: [{ key: 'C1', name: 'Survey' }],
			zoteroKey: 'ZK1',
		});

		expect(store.get('r')).toMatchObject({
			status: 'rejected',
			reject_reason: 'too-old',
			decided_at: '2026-11-03T00:00:00.000Z',
		});
		expect(store.get('a')).toMatchObject({
			status: 'accepted',
			directions: ['llm'],
			collections: [{ key: 'C1', name: 'Survey' }],
			zotero_key: 'ZK1',
		});
		expect(store.counts()).toEqual({ unchecked: 0, accepted: 1, rejected: 1 });
	});

	it('marks an acceptance without a Zotero key as a manual import', () => {
		store.add({ key: 'm', title: 'M' });

		store.accept('m', { directions: [], collections: [] });

		expect(store.get('m')).toMatchObject({
			status: 'accepted',
			manual_import: true,
		});
		expect(store.get('m')).not.toHaveProperty('zotero_key');

		store.restore('m');
		expect(store.get('m')).not.toHaveProperty('manual_import');
	});

	it('restores a decided paper and clears the decision', () => {
		store.add({ key: 'a', title: 'A' });
		store.accept('a', {
			directions: ['llm'],
			collections: [{ key: 'C1', name: 'Survey' }],
			zoteroKey: 'ZK1',
		});

		store.restore('a');

		expect(store.get('a')).toEqual({
			key: 'a',
			title: 'A',
			status: 'unchecked',
			added_at: '2026-11-01T00:00:00.000Z',
		});
	});

	it('throws when deciding a paper that is not stored', () => {
		expect(() => store.reject('missing', 'other')).toThrow('Paper not found');
		expect(() => store.restore('missing')).toThrow('Paper not found');
	});

	it('reports batches that still have unchecked papers and withdraws one', () => {
		store.add({ key: 'a', title: 'A' }, 'bib-2');
		store.add({ key: 'b', title: 'B' }, 'bib-1');
		store.add({ key: 'c', title: 'C' }, 'bib-1');
		store.add({ key: 'd', title: 'D' });
		store.reject('c', 'other');

		expect(store.batches()).toEqual(['bib-1', 'bib-2']);
		expect(store.withdrawBatch('bib-1')).toBe(1);
		expect(store.get('b')).toBeUndefined();
		expect(store.get('c')?.status).toBe('rejected');
		expect(store.batches()).toEqual(['bib-2']);
	});

	it('cleans up only decided papers older than the retention period', () => {
		store.add({ key: 'old-rejected', title: 'x' });
		store.add({ key: 'old-unchecked', title: 'x' });
		store.add({ key: 'recent', title: 'x' });
		store.reject('old-rejected', 'other');
		now = new Date('2026-11-25T00:00:00Z');
		store.reject('recent', 'other');
		now = new Date('2026-12-05T00:00:00Z');

		expect(store.cleanup(30)).toBe(1);
		expect(store.get('old-rejected')).toBeUndefined();
		expect(store.get('old-unchecked')?.status).toBe('unchecked');
		expect(store.get('recent')?.status).toBe('rejected');
	});

	it('does not clean up when retention is zero or the date is unreadable', async () => {
		store.add({ key: 'a', title: 'x' });
		store.reject('a', 'other');
		now = new Date('2030-01-01T00:00:00Z');
		expect(store.cleanup(0)).toBe(0);

		({ files } = memoryFiles({
			[STORE_PATH]: JSON.stringify({
				version: 1,
				records: {
					bad: {
						key: 'bad',
						title: 'x',
						status: 'rejected',
						decided_at: 'nonsense',
					},
					none: { key: 'none', title: 'x', status: 'accepted' },
				},
			}),
		}));
		const odd = new DigestStore(files, STORE_PATH, () => now);
		await odd.load();
		expect(odd.cleanup(30)).toBe(0);
		expect(odd.invalidLines()).toEqual([]);
	});

	it('keeps, caps and clears invalid lines', () => {
		store.addInvalid('{bad', 'Not valid JSON', 'a.jsonl');
		expect(store.invalidLines()).toEqual([
			{
				raw: '{bad',
				reason: 'Not valid JSON',
				file: 'a.jsonl',
				at: '2026-11-01T00:00:00.000Z',
			},
		]);

		for (let i = 0; i < 510; i++) store.addInvalid(`line ${i}`, 'r', 'b.jsonl');
		expect(store.invalidLines()).toHaveLength(500);
		expect(store.invalidLines()[499].raw).toBe('line 509');

		store.clearInvalid();
		expect(store.invalidLines()).toEqual([]);
	});

	it('round-trips through save and load', async () => {
		store.add({ key: 'a', title: 'A', doi: '10.1000/a' });
		store.addInvalid('x', 'r', 'f');
		await store.save();

		const reloaded = new DigestStore(files, STORE_PATH);
		await reloaded.load();

		expect(reloaded.get('a')?.doi).toBe('10.1000/a');
		expect(reloaded.invalidLines()).toHaveLength(1);
		expect(JSON.parse(data.get(STORE_PATH) as string).version).toBe(1);
	});

	it('refuses to load a damaged file instead of overwriting it', async () => {
		const notJson = new DigestStore(
			memoryFiles({ [STORE_PATH]: '{oops' }).files,
			STORE_PATH
		);
		await expect(notJson.load()).rejects.toThrow('not valid JSON');

		const wrongShape = new DigestStore(
			memoryFiles({ [STORE_PATH]: '[]' }).files,
			STORE_PATH
		);
		await expect(wrongShape.load()).rejects.toThrow('unexpected shape');

		const nullData = new DigestStore(
			memoryFiles({ [STORE_PATH]: 'null' }).files,
			STORE_PATH
		);
		await expect(nullData.load()).rejects.toThrow('unexpected shape');
	});

	it('uses the current time when no clock is supplied', () => {
		const real = new DigestStore(files, STORE_PATH);
		real.add({ key: 'a', title: 'A' });
		expect(Date.parse(real.get('a')?.added_at as string)).not.toBeNaN();
	});
});

describe('digest helpers', () => {
	it('normalises identifiers', () => {
		expect(normaliseId('  10.1000/ABC ')).toBe('10.1000/abc');
	});

	it('merges stored settings over the defaults', () => {
		expect(resolveDigestSettings()).toEqual(DEFAULT_DIGEST_SETTINGS);
		expect(resolveDigestSettings({ retentionDays: 7 })).toMatchObject({
			retentionDays: 7,
			translationServerUrl: 'http://127.0.0.1:1969',
			tagPrefix: 'dir/',
		});
	});

	it('offers unarchived vocabulary entries and derives a missing id from the label', () => {
		expect(
			activeVocab([
				{ id: 'a', label: 'A' },
				{ id: ' ', label: ' LLM Serving! ' },
				{ id: '', label: '' },
				{ id: 'b', label: 'B', archived: true },
			])
		).toEqual([
			{ id: 'a', label: 'A' },
			{ id: 'llm-serving', label: ' LLM Serving! ' },
		]);
		expect(toVocabId('  GPU / Memory  ')).toBe('gpu-memory');
	});

	it('reads a header regardless of case', () => {
		expect(getHeader({ 'zotero-server-id': 'S' }, 'Zotero-Server-ID')).toBe('S');
		expect(getHeader({}, 'Zotero-Server-ID')).toBeUndefined();
	});
});
