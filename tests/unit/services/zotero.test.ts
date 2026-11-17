import { ZoteroService } from '../../../src/services/zotero';
import { request, RequestUrlParam, resetObsidianMocks } from '../../__mocks__/obsidian';

function queueRpc(...results: unknown[]): void {
	for (const result of results) {
		request.mockResolvedValueOnce(JSON.stringify({ result }));
	}
}

function reqAt(callIndex: number): RequestUrlParam {
	const raw = request.mock.calls[callIndex][0];
	if (typeof raw === 'string') {
		return { url: raw };
	}
	return raw;
}

function rpcBody(callIndex: number): {
	jsonrpc: string;
	method: string;
	params: unknown[];
} {
	const body = reqAt(callIndex).body;
	return JSON.parse(typeof body === 'string' ? body : '') as {
		jsonrpc: string;
		method: string;
		params: unknown[];
	};
}

function exportResult(item: Record<string, unknown>): string[] {
	return ['format', 'extra', JSON.stringify({ items: [item] })];
}

describe('ZoteroService', () => {
	let service: ZoteroService;
	let errorSpy: jest.SpyInstance;

	beforeEach(() => {
		resetObsidianMocks();
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		service = new ZoteroService(23119);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('JSON-RPC transport', () => {
		it('posts to the Better BibTeX endpoint with non-browser headers', async () => {
			queueRpc([{ library: 'My Library' }], [], null);

			await service.getRawMetadata('doe2020');

			const options = reqAt(0);
			expect(options.url).toBe('http://127.0.0.1:23119/better-bibtex/json-rpc');
			expect(options.method).toBe('POST');
			expect(options.headers?.['Content-Type']).toBe('application/json');
			expect(options.headers?.['User-Agent']).toBe('obsidian/zotero');
			expect(options.headers?.Origin).toBeUndefined();
			expect(rpcBody(0)).toEqual({
				jsonrpc: '2.0',
				method: 'item.search',
				params: ['doe2020'],
			});
		});

		it('logs and rethrows HTTP transport errors, JSON-RPC errors, and non-JSON payloads', async () => {
			request.mockRejectedValueOnce(new Error('Connection refused'));
			await expect(service.getRawMetadata('invalid')).rejects.toThrow(
				'Connection refused'
			);
			expect(errorSpy).toHaveBeenCalled();

			request.mockResolvedValueOnce(
				JSON.stringify({ error: { code: -32601, message: 'Method not found' } })
			);
			await expect(service.getAnnotations('doe2020')).rejects.toThrow(
				/Method not found/
			);

			request.mockResolvedValueOnce('<html>not json</html>');
			await expect(service.getItemMetadata('doe2020')).rejects.toThrow(
				SyntaxError
			);
		});
	});

	describe('resolveLibraryId and library caching', () => {
		it('resolves group library ID, strips single leading @, and caches user.groups per instance', async () => {
			queueRpc(
				[{ library: 'My Group' }],
				[{ id: 5, name: 'My Group' }],
				exportResult({
					key: 'XYZ123',
					title: 'Test Paper',
					creators: [{ firstName: 'John', lastName: 'Doe' }],
				})
			);

			const result = await service.getItemMetadata('@doe2020');
			expect(result?.title).toBe('Test Paper');
			expect(result?.creators).toContain('John Doe');
			expect(rpcBody(2).params).toEqual([
				['doe2020'],
				'36a3b0b5-bad0-4a04-b79b-441c7cef77db',
				5,
			]);

			// Second lookup reuses cached library map without calling user.groups again
			queueRpc([{ library: 'My Group' }], 'cached-raw');
			await expect(service.getRawMetadata('@@doe@2020')).resolves.toBe(
				'cached-raw'
			);
			expect(rpcBody(3).params).toEqual(['@doe@2020']);
			expect(rpcBody(4).params[2]).toBe(5);
		});

		it('handles missing citekey hits, personal library fallback, unknown groups, and malformed group entries', async () => {
			queueRpc([]);
			await expect(service.getItemMetadata('@notfound')).rejects.toThrow(
				"Citation Key 'notfound' not found."
			);

			queueRpc(null);
			await expect(service.getRawMetadata('missing')).rejects.toThrow(
				/not found/
			);

			const s1 = new ZoteroService(23119);
			queueRpc([{ citekey: 'doe2020' }], [{ id: 7, name: 'Group' }], 'raw');
			await s1.getRawMetadata('doe2020');
			expect(rpcBody(4).params[2]).toBe(1);

			const s2 = new ZoteroService(23119);
			queueRpc(
				[{ library: 'No Id' }],
				[null, { name: 'No Id' }, { id: 9 }, { id: 4, name: 'Valid' }],
				'raw'
			);
			await s2.getRawMetadata('doe2020');
			expect(rpcBody(7).params[2]).toBe('*');
		});
	});

	describe('getItemMetadata', () => {
		async function metadataFor(exported: unknown) {
			queueRpc(
				[{ library: 'My Library' }],
				[{ name: 'My Library', id: 1 }],
				exported
			);
			return new ZoteroService(23119).getItemMetadata('@key');
		}

		it('parses array, JSON string, and object export payloads and returns null on invalid shapes', async () => {
			await expect(metadataFor(null)).resolves.toBeNull();
			await expect(metadataFor('{not json')).resolves.toBeNull();
			await expect(
				metadataFor(['format', 'extra', '{not json'])
			).resolves.toBeNull();
			await expect(
				metadataFor(JSON.stringify({ items: [] }))
			).resolves.toBeNull();
			await expect(metadataFor(['only', 'two'])).resolves.toBeNull();
			await expect(metadataFor({ config: {} })).resolves.toBeNull();

			const fromString = await metadataFor(
				JSON.stringify({ items: [{ key: 'S1', title: 'From String' }] })
			);
			expect(fromString?.key).toBe('S1');

			const fromObject = await metadataFor({
				items: [{ key: 'O1', title: 'From Object' }],
			});
			expect(fromObject?.title).toBe('From Object');
		});

		it('maps full item fields, defaults, and publication fallbacks', async () => {
			const full = await metadataFor(
				exportResult({
					key: 'FULL1',
					itemType: 'journalArticle',
					title: 'Full Paper',
					creators: [
						{ name: 'ACME Consortium' },
						{ firstName: 'Jane', lastName: 'Roe' },
						{ lastName: 'Solo' },
						{ firstName: 'Mono' },
						{},
					],
					date: '2024-05-01',
					publicationTitle: 'Journal of Tests',
					proceedingsTitle: 'Ignored Proceedings',
					DOI: '10.1000/xyz',
					url: 'https://example.org/paper',
					abstractNote: 'An abstract.',
					tags: [{ tag: 'ml' }, {}],
					volume: '12',
					issue: '3',
					pages: '1-10',
					publisher: 'Test Press',
				})
			);
			expect(full).toEqual({
				key: 'FULL1',
				itemType: 'journalArticle',
				title: 'Full Paper',
				creators: ['ACME Consortium', 'Jane Roe', 'Solo', 'Mono', ''],
				date: '2024-05-01',
				publication: 'Journal of Tests',
				doi: '10.1000/xyz',
				url: 'https://example.org/paper',
				abstract: 'An abstract.',
				tags: ['ml', ''],
				zoteroNotes: [],
				volume: '12',
				issue: '3',
				pages: '1-10',
				publisher: 'Test Press',
			});

			const min = await metadataFor(exportResult({}));
			expect(min?.itemType).toBe('unknown');
			expect(min?.key).toBe('');

			const proceedings = await metadataFor(
				exportResult({
					key: 'P1',
					proceedingsTitle: 'Proc. of Tests',
					conferenceName: 'TestConf',
				})
			);
			expect(proceedings?.publication).toBe('Proc. of Tests');

			const conference = await metadataFor(
				exportResult({ key: 'C1', conferenceName: 'TestConf' })
			);
			expect(conference?.publication).toBe('TestConf');
		});
	});

	describe('getAnnotations', () => {
		async function annotationsFor(attachments: unknown) {
			queueRpc(
				[{ library: 'My Library' }],
				[{ name: 'My Library', id: 1 }],
				attachments
			);
			return new ZoteroService(23119).getAnnotations('@doe2020');
		}

		it('parses annotations across attachment formats, types, page labels, dates, positions, and open/uri links', async () => {
			await expect(annotationsFor(null)).resolves.toEqual([]);
			await expect(annotationsFor('not-an-array')).resolves.toEqual([]);

			const list = await annotationsFor([
				null,
				{ itemKey: 'NO_ANN', title: 'Skip' },
				{
					itemKey: 'ABC123',
					title: 'PDF',
					annotations: [
						null,
						{
							key: 'ann1',
							annotationType: 'highlight',
							annotationText: 'quote',
							annotationComment: 'note',
							annotationColor: '#yellow',
							annotationPageLabel: 'iv',
							annotationPosition: { pageIndex: 0 },
							dateAdded: '2024-01-01T00:00:00Z',
						},
						{
							key: 'ann2',
							annotationType: 'image',
							page: 7,
							position: 'raw-pos',
							dateModified: '2024-01-02',
						},
						{
							key: 'ann3',
							annotationType: 'ink',
							date: '2024-01-03',
						},
						{
							key: 'ann4',
							annotationType: 'note',
						},
						{
							annotationType: 'underline',
						},
					],
				},
				{
					open: 'zotero://open-pdf/library/items/OPEN1',
					path: '/data/storage/OPEN1/paper.pdf',
					annotations: [{ key: 'aOpen1', annotationPageLabel: '2' }],
				},
				{
					open: 'zotero://open-pdf/groups/5/items/OPEN2?sel=1',
					path: 'C:\\Zotero\\storage\\OPEN2\\slides.pdf',
					annotations: [{ key: 'aOpen2', annotationPageLabel: '3' }],
				},
				{
					uri: 'http://zotero.org/users/1/items/URI1',
					annotations: [{ key: 'aUri1', annotationPageLabel: '1' }],
				},
				{
					uri: 'http://zotero.org/users/1/items/',
					open: 'zotero://select/library',
					path: '/trailing/slash/',
					annotations: [{ key: 'aEmpty', page: 1 }],
				},
			]);

			expect(list.map((a) => a.type)).toEqual([
				'highlight',
				'image',
				'ink',
				'note',
				'unknown',
				'unknown',
				'unknown',
				'unknown',
				'unknown',
			]);
			expect(list[0]).toMatchObject({
				key: 'ann1',
				pageLabel: 'iv',
				link: 'zotero://open-pdf/library/items/ABC123?page=iv&annotation=ann1',
				position: { pageIndex: 0 },
				date: '2024-01-01T00:00:00Z',
			});
			expect(list[1]).toMatchObject({
				pageLabel: 7,
				position: 'raw-pos',
				date: '2024-01-02',
			});
			expect(list[2]).toMatchObject({
				pageLabel: '?',
				color: '#aaaaaa',
				date: '2024-01-03',
			});
			expect(list[5].link).toBe(
				'zotero://open-pdf/library/items/OPEN1?page=2&annotation=aOpen1'
			);
			expect(list[5].attachmentTitle).toBe('paper.pdf');
			expect(list[6].link).toBe(
				'zotero://open-pdf/groups/5/items/OPEN2?sel=1&page=3&annotation=aOpen2'
			);
			expect(list[6].attachmentTitle).toBe('slides.pdf');
			expect(list[7].link).toBe(
				'zotero://open-pdf/library/items/URI1?page=1&annotation=aUri1'
			);
			expect(list[7].attachmentTitle).toBe('Unknown Attachment');
			expect(list[8].link).toBe(
				'zotero://select/library?page=1&annotation=aEmpty'
			);
			expect(list[8].attachmentTitle).toBe('Unknown Attachment');
		});
	});
});
