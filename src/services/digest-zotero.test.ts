import { TranslationLookup, ZoteroItemJson } from './digest-translate';
import {
	DigestHttp,
	DigestHttpRequest,
	DigestHttpResponse,
	DigestRecord,
} from './digest-types';
import {
	ZoteroLocalClient,
	ZoteroWriteResult,
	acceptRecord,
	buildCollectionList,
	directionTags,
	prepareLookupItem,
} from './digest-zotero';

type Reply = Partial<DigestHttpResponse> | Error;

const SERVER_ID = 'sDkJLP2UTvTm';
const COLLECTIONS = [
	{ key: 'C2', data: { key: 'C2', name: 'Architecture', parentCollection: 'C1' } },
	{ key: 'C1', data: { key: 'C1', name: 'infrastructure', parentCollection: false } },
	{ key: 'C3', data: { key: 'C3', name: 'Visualisation', parentCollection: false } },
];
const WRITE_OK = JSON.stringify({
	successful: { '0': { key: 'ALAWJ7PH' } },
	success: { '0': 'ALAWJ7PH' },
	unchanged: {},
	failed: {},
});

function setup(
	routes: Partial<Record<'collections' | 'authorize' | 'items', Reply[]>>
) {
	const requests: DigestHttpRequest[] = [];
	const queues = {
		collections: [...(routes.collections ?? [])],
		authorize: [...(routes.authorize ?? [])],
		items: [...(routes.items ?? [])],
	};
	const http: DigestHttp = async (request) => {
		requests.push(request);
		const route = request.url.endsWith('/collections')
			? 'collections'
			: request.url.endsWith('/authorize')
				? 'authorize'
				: 'items';
		const reply = queues[route].shift();
		if (!reply) throw new Error(`unexpected request to ${route}`);
		if (reply instanceof Error) throw reply;
		return { status: 200, text: '', headers: {}, ...reply };
	};
	const keys = { value: null as string | null };
	const client = new ZoteroLocalClient(http, () => 23119, {
		get: async () => keys.value,
		set: async (key) => {
			keys.value = key;
		},
	});
	const sent = (route: string) =>
		requests.filter((request) => request.url.endsWith(`/${route}`));
	return { client, requests, keys, sent };
}

const collectionsOk: Reply = {
	headers: { 'Zotero-Server-ID': SERVER_ID },
	text: JSON.stringify(COLLECTIONS),
};
const authorizeOk = (remember: boolean): Reply => ({
	text: JSON.stringify({ key: 'local-key', remember }),
});

describe('buildCollectionList', () => {
	it('orders collections as a tree with full paths', () => {
		expect(buildCollectionList(COLLECTIONS)).toEqual([
			{ key: 'C1', name: 'infrastructure', path: 'infrastructure', depth: 0 },
			{
				key: 'C2',
				name: 'Architecture',
				path: 'infrastructure / Architecture',
				depth: 1,
			},
			{ key: 'C3', name: 'Visualisation', path: 'Visualisation', depth: 0 },
		]);
	});

	it('accepts flat entries and skips unusable ones', () => {
		expect(
			buildCollectionList([
				{ key: 'A', name: 'Flat' },
				{ key: 'B', data: { name: 3 } },
				{ data: { name: 'No key' } },
				null,
				{ key: 'D', data: { name: 'Orphan', parentCollection: 'GONE' } },
			]).map((collection) => collection.path)
		).toEqual(['Flat', 'Orphan']);
		expect(buildCollectionList('nope')).toEqual([]);
	});

	it('does not loop on cyclic parents', () => {
		const list = buildCollectionList([
			{ key: 'A', data: { name: 'a', parentCollection: 'B' } },
			{ key: 'B', data: { name: 'b', parentCollection: 'A' } },
		]);

		expect(list.map((collection) => collection.path).sort()).toEqual([
			'a / b',
			'b / a',
		]);
	});
});

describe('item builders', () => {
	it('builds manual direction tags with the prefix', () => {
		expect(directionTags('dir/', ['llm', 'gpu'])).toEqual([
			{ tag: 'dir/llm' },
			{ tag: 'dir/gpu' },
		]);
	});

	it('replaces translator tags, strips non-API fields and sets the collection', () => {
		const looked: ZoteroItemJson = {
			key: '5385JXGT',
			version: 0,
			itemType: 'preprint',
			title: 'T',
			tags: [{ tag: 'cs.LG', type: 1 }],
			attachments: [],
			notes: [],
			seeAlso: [],
			id: 1,
			itemID: 2,
		};

		expect(prepareLookupItem(looked, [{ tag: 'dir/llm' }], ['C2'])).toEqual({
			itemType: 'preprint',
			title: 'T',
			tags: [{ tag: 'dir/llm' }],
			collections: ['C2'],
		});
		expect(prepareLookupItem(looked, [], []).collections).toEqual([]);
		expect(looked.key).toBe('5385JXGT');
	});
});

describe('ZoteroLocalClient.status', () => {
	it('returns the collections and sends the request headers', async () => {
		const { client, requests } = setup({ collections: [collectionsOk] });

		const status = await client.status();

		expect(status.state).toBe('online');
		expect(status.state === 'online' && status.collections).toHaveLength(3);
		expect(requests[0]).toEqual({
			url: 'http://127.0.0.1:23119/api/users/0/collections',
			method: 'GET',
			headers: {
				'Zotero-API-Version': '3',
				'Zotero-Allowed-Request': '1',
				'User-Agent': 'obsidian/zotero',
			},
		});
	});

	it.each<[string, Reply, object]>([
		['offline when the request fails', new Error('refused'), { state: 'offline' }],
		[
			'disabled for HTTP 403',
			{ status: 403, text: 'Local API is not enabled' },
			{ state: 'disabled' },
		],
		[
			'an error for another status',
			{ status: 500 },
			{ state: 'error', message: 'Zotero answered HTTP 500' },
		],
		[
			'an error for an unreadable body',
			{ text: 'not json' },
			{
				state: 'error',
				message: 'Zotero returned an unreadable collection list',
			},
		],
	])('reports %s', async (_name, reply, expected) => {
		const { client } = setup({ collections: [reply] });

		expect(await client.status()).toEqual(expected);
	});
});

describe('ZoteroLocalClient.createItem', () => {
	const item: ZoteroItemJson = { itemType: 'preprint', title: 'T' };

	it('probes, authorizes with the server id, then writes the item', async () => {
		const { client, sent, keys } = setup({
			collections: [collectionsOk],
			authorize: [authorizeOk(true)],
			items: [{ text: WRITE_OK }],
		});

		expect(await client.createItem(item)).toEqual({ ok: true, key: 'ALAWJ7PH' });

		const authorize = sent('authorize')[0];
		expect(authorize.headers?.['Zotero-Server-ID']).toBe(SERVER_ID);
		expect(JSON.parse(authorize.body as string)).toEqual({
			appName: 'Obsidian Paper Digest',
		});
		const write = sent('items')[0];
		expect(write.url).toBe('http://127.0.0.1:23119/api/users/0/items');
		expect(write.headers).toMatchObject({
			'Zotero-API-Key': 'local-key',
			'Zotero-Server-ID': SERVER_ID,
			'Content-Type': 'application/json',
		});
		expect(JSON.parse(write.body as string)).toEqual([item]);
		expect(keys.value).toBe('local-key');
	});

	it('does not store a single-use key', async () => {
		const { client, keys } = setup({
			collections: [collectionsOk],
			authorize: [authorizeOk(false)],
			items: [{ text: WRITE_OK }],
		});

		expect((await client.createItem(item)).ok).toBe(true);
		expect(keys.value).toBeNull();
	});

	it('reuses a stored key and the known server id', async () => {
		const { client, keys, sent } = setup({
			collections: [collectionsOk],
			items: [{ text: WRITE_OK }, { text: WRITE_OK }],
		});
		keys.value = 'stored';
		await client.status();

		await client.createItem(item);
		await client.createItem(item);

		expect(sent('collections')).toHaveLength(1);
		expect(sent('authorize')).toHaveLength(0);
		expect(sent('items')[1].headers?.['Zotero-API-Key']).toBe('stored');
	});

	it('re-authorizes once when the stored key is refused', async () => {
		const { client, keys, sent } = setup({
			collections: [collectionsOk],
			authorize: [authorizeOk(true)],
			items: [{ status: 401 }, { text: WRITE_OK }],
		});
		keys.value = 'stale';

		expect(await client.createItem(item)).toEqual({ ok: true, key: 'ALAWJ7PH' });
		expect(
			sent('items').map((request) => request.headers?.['Zotero-API-Key'])
		).toEqual(['stale', 'local-key']);
		expect(keys.value).toBe('local-key');
	});

	it('reads the key from the successful map when success is absent', async () => {
		const { client } = setup({
			collections: [collectionsOk],
			authorize: [authorizeOk(true)],
			items: [
				{ text: JSON.stringify({ successful: { '0': { key: 'FROMFULL' } } }) },
			],
		});

		expect(await client.createItem(item)).toEqual({ ok: true, key: 'FROMFULL' });
	});

	it.each<[string, Reply, string]>([
		[
			'a per-item failure',
			{
				text: JSON.stringify({
					success: {},
					failed: { '0': { message: 'Invalid field' } },
				}),
			},
			'Zotero rejected the item: Invalid field',
		],
		['an empty result', { text: '{}' }, 'Zotero did not report a created item'],
		['HTTP 403', { status: 403 }, 'Zotero local API is not enabled'],
		[
			'another status',
			{ status: 412, text: 'Server ID mismatch' },
			'Zotero refused the item (HTTP 412): Server ID mismatch',
		],
		['a failed request', new Error('socket hang up'), 'socket hang up'],
	])('reports %s', async (_name, reply, reason) => {
		const { client } = setup({
			collections: [collectionsOk],
			authorize: [authorizeOk(true)],
			items: [reply],
		});

		expect(await client.createItem(item)).toEqual({ ok: false, reason });
	});

	it('fails when Zotero cannot be probed', async () => {
		const { client } = setup({ collections: [new Error('refused')] });

		expect(await client.createItem(item)).toEqual({
			ok: false,
			reason: 'Zotero is not reachable',
		});
	});

	it.each<[string, Reply, string]>([
		[
			'no local writes',
			{ status: 404 },
			'This Zotero version does not support local writes',
		],
		[
			'a disabled local API',
			{ status: 403, text: 'Local API is not enabled' },
			'Zotero local API is not enabled',
		],
		[
			'a denied prompt',
			{ status: 403, text: '{"denied":true}' },
			'Write access was denied in Zotero',
		],
		['another status', { status: 428 }, 'Zotero authorization failed (HTTP 428)'],
		['a missing key', { text: '{}' }, 'Zotero returned no write key'],
	])('reports authorization with %s', async (_name, reply, reason) => {
		const { client } = setup({ collections: [collectionsOk], authorize: [reply] });

		expect(await client.createItem(item)).toEqual({ ok: false, reason });
	});

	it('sends an empty server id when Zotero did not return one', async () => {
		const { client, sent } = setup({
			collections: [{ text: '[]' }],
			authorize: [authorizeOk(true)],
			items: [{ text: WRITE_OK }],
		});

		await client.createItem(item);

		expect(sent('authorize')[0].headers?.['Zotero-Server-ID']).toBe('');
		expect(sent('items')[0].headers?.['Zotero-Server-ID']).toBe('');
	});
});

describe('acceptRecord', () => {
	const record: DigestRecord = {
		key: '10.1000/a',
		title: 'Title',
		doi: '10.1000/a',
		status: 'unchecked',
		added_at: '2026-11-01T00:00:00.000Z',
	};
	const tags = [{ tag: 'dir/llm' }];

	function deps(
		lookup: TranslationLookup,
		write: ZoteroWriteResult = { ok: true, key: 'ZK' }
	) {
		const created: ZoteroItemJson[] = [];
		return {
			created,
			lookup: jest.fn(async () => lookup),
			createItem: jest.fn(async (item: ZoteroItemJson) => {
				created.push(item);
				return write;
			}),
		};
	}

	it('looks the DOI up and writes the prepared item', async () => {
		const d = deps({
			ok: true,
			item: { itemType: 'preprint', key: 'X', tags: [{ tag: 'a' }] },
		});

		expect(await acceptRecord(d, record, tags, ['C2', 'C3'])).toEqual({
			ok: true,
			key: 'ZK',
		});
		expect(d.lookup).toHaveBeenCalledWith('10.1000/a');
		expect(d.created[0]).toEqual({
			itemType: 'preprint',
			tags,
			collections: ['C2', 'C3'],
		});
	});

	it('writes nothing when the paper has no DOI', async () => {
		const d = deps({ ok: true, item: { itemType: 'preprint' } });

		expect(
			await acceptRecord(d, { ...record, doi: undefined }, tags, ['C2'])
		).toEqual({
			ok: false,
			reason: 'This paper has no DOI to look up',
		});
		expect(d.lookup).not.toHaveBeenCalled();
		expect(d.createItem).not.toHaveBeenCalled();
	});

	it('writes nothing when the lookup fails', async () => {
		const d = deps({ ok: false, reason: 'Lookup found nothing for 10.1000/a' });

		expect(await acceptRecord(d, record, tags, ['C2'])).toEqual({
			ok: false,
			reason: 'Lookup found nothing for 10.1000/a',
		});
		expect(d.createItem).not.toHaveBeenCalled();
	});

	it('reports a failed write', async () => {
		const d = deps(
			{ ok: true, item: { itemType: 'preprint' } },
			{ ok: false, reason: 'Zotero rejected the item: x' }
		);

		expect(await acceptRecord(d, record, tags, [])).toEqual({
			ok: false,
			reason: 'Zotero rejected the item: x',
		});
	});
});
