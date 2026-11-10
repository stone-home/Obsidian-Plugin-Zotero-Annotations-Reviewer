import { ZoteroService } from './zotero';
import { request } from 'obsidian';

jest.mock('obsidian', () => ({
	request: jest.fn(),
}));

const requestMock = request as jest.Mock;

function queueRpc(...results: unknown[]): void {
	for (const result of results) {
		requestMock.mockResolvedValueOnce(JSON.stringify({ result }));
	}
}

function rpcBody(callIndex: number): {
	jsonrpc: string;
	method: string;
	params: any[];
} {
	return JSON.parse(requestMock.mock.calls[callIndex][0].body);
}

function exportResult(item: Record<string, unknown>): string[] {
	return ['format', 'extra', JSON.stringify({ items: [item] })];
}

describe('ZoteroService', () => {
	let service: ZoteroService;

	beforeAll(() => {
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		jest.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterAll(() => {
		jest.restoreAllMocks();
	});

	beforeEach(() => {
		requestMock.mockReset();
		service = new ZoteroService(23119);
	});

	describe('JSON-RPC transport', () => {
		it('should post to the Better BibTeX endpoint with non-browser headers', async () => {
			queueRpc([{ library: 'My Library' }], [], null);

			await service.getRawMetadata('doe2020');

			const options = requestMock.mock.calls[0][0];
			expect(options.url).toBe('http://127.0.0.1:23119/better-bibtex/json-rpc');
			expect(options.method).toBe('POST');
			expect(options.headers['Content-Type']).toBe('application/json');
			expect(options.headers['User-Agent']).toBe('obsidian/zotero');
			expect(options.headers.Origin).toBeUndefined();
			expect(rpcBody(0)).toEqual({
				jsonrpc: '2.0',
				method: 'item.search',
				params: ['doe2020'],
			});
		});

		it('should handle HTTP errors gracefully', async () => {
			requestMock.mockRejectedValue(new Error('Connection refused'));

			await expect(service.getRawMetadata('invalid')).rejects.toThrow(
				'Connection refused'
			);
			expect(console.error).toHaveBeenCalled();
		});

		it('should throw when the JSON-RPC payload carries an error', async () => {
			requestMock.mockResolvedValueOnce(
				JSON.stringify({ error: { code: -32601, message: 'Method not found' } })
			);

			await expect(service.getAnnotations('doe2020')).rejects.toThrow(
				/Method not found/
			);
		});

		it('should throw when the response body is not JSON', async () => {
			requestMock.mockResolvedValueOnce('<html>not json</html>');

			await expect(service.getItemMetadata('doe2020')).rejects.toThrow(
				SyntaxError
			);
		});
	});

	describe('resolveLibraryId', () => {
		it('should resolve library ID and fetch metadata', async () => {
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

			expect(result).not.toBeNull();
			expect(result?.title).toBe('Test Paper');
			expect(result?.creators).toContain('John Doe');
			expect(request).toHaveBeenCalledTimes(3);
			expect(rpcBody(0).method).toBe('item.search');
			expect(rpcBody(1)).toMatchObject({ method: 'user.groups', params: [] });
			expect(rpcBody(2).method).toBe('item.export');
			expect(rpcBody(2).params).toEqual([
				['doe2020'],
				'36a3b0b5-bad0-4a04-b79b-441c7cef77db',
				5,
			]);
		});

		it('should strip a leading @ from the citation key', async () => {
			queueRpc([{ library: 'My Library' }], [], []);

			await service.getAnnotations('@doe2020');

			expect(rpcBody(0).params).toEqual(['doe2020']);
			expect(rpcBody(2).params).toEqual(['doe2020', 1]);
		});

		it('should only strip one leading @ and keep inner ones', async () => {
			queueRpc([{ library: 'My Library' }], [], []);

			await service.getAnnotations('@@doe@2020');

			expect(rpcBody(0).params).toEqual(['@doe@2020']);
		});

		it('should throw when citation key not found in search', async () => {
			queueRpc([]);

			await expect(service.getItemMetadata('@notfound')).rejects.toThrow(
				"Citation Key 'notfound' not found."
			);
			expect(request).toHaveBeenCalledTimes(1);
		});

		it('should throw when search returns no result at all', async () => {
			queueRpc(null);

			await expect(service.getRawMetadata('missing')).rejects.toThrow(
				/not found/
			);
		});

		it('should use the personal library when the hit has no library name', async () => {
			queueRpc([{ citekey: 'doe2020' }], [{ id: 7, name: 'Group' }], 'raw');

			await service.getRawMetadata('doe2020');

			expect(rpcBody(2).params[2]).toBe(1);
		});

		it('should use the personal library when the hit is not an object', async () => {
			queueRpc(['doe2020'], null, 'raw');

			await service.getRawMetadata('doe2020');

			expect(rpcBody(2).params[2]).toBe(1);
		});

		it('should search all libraries when the library name is unknown', async () => {
			queueRpc([{ library: 'Ghost Group' }], [{ id: 7, name: 'Group' }], 'raw');

			await service.getRawMetadata('doe2020');

			expect(rpcBody(2).params[2]).toBe('*');
		});

		it('should ignore malformed group entries', async () => {
			queueRpc(
				[{ library: 'No Id' }],
				[null, { name: 'No Id' }, { id: 9 }, { id: 4, name: 'Valid' }],
				'raw'
			);

			await service.getRawMetadata('doe2020');

			expect(rpcBody(2).params[2]).toBe('*');
		});

		it('should cache the library map per service instance', async () => {
			queueRpc([{ library: 'Group' }], [{ id: 7, name: 'Group' }], 'first');
			queueRpc([{ library: 'Group' }], 'second');

			await service.getRawMetadata('a');
			await service.getRawMetadata('b');

			expect(request).toHaveBeenCalledTimes(5);
			const methods = requestMock.mock.calls.map((_, i) => rpcBody(i).method);
			expect(methods).toEqual([
				'item.search',
				'user.groups',
				'item.export',
				'item.search',
				'item.export',
			]);
			expect(rpcBody(4).params[2]).toBe(7);
		});
	});

	describe('getRawMetadata', () => {
		it('should return the export result untouched', async () => {
			const raw = ['format', 'extra', '{"items":[]}'];
			queueRpc([{ library: 'My Library' }], [], raw);

			await expect(service.getRawMetadata('@doe2020')).resolves.toEqual(raw);
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

		it('should return null when getItemMetadata gets no result', async () => {
			await expect(metadataFor(null)).resolves.toBeNull();
		});

		it('should parse item metadata when result is array with JSON in third element', async () => {
			const result = await metadataFor(
				exportResult({
					title: 'From Array',
					creators: [],
					key: 'k',
					itemType: 'article',
					date: '',
					publicationTitle: '',
					DOI: '',
					url: '',
					abstractNote: '',
					tags: [],
				})
			);

			expect(result?.title).toBe('From Array');
		});

		it('should parse item metadata when result is a JSON string', async () => {
			const result = await metadataFor(
				JSON.stringify({ items: [{ key: 'S1', title: 'From String' }] })
			);

			expect(result?.key).toBe('S1');
			expect(result?.title).toBe('From String');
		});

		it('should parse item metadata when result is already an object', async () => {
			const result = await metadataFor({
				items: [{ key: 'O1', title: 'From Object' }],
			});

			expect(result?.title).toBe('From Object');
		});

		it('should return null when the string export is invalid JSON', async () => {
			await expect(metadataFor('{not json')).resolves.toBeNull();
		});

		it('should return null when the array export holds invalid JSON', async () => {
			await expect(
				metadataFor(['format', 'extra', '{not json'])
			).resolves.toBeNull();
		});

		it('should return null when the export has no items', async () => {
			await expect(
				metadataFor(JSON.stringify({ items: [] }))
			).resolves.toBeNull();
			await expect(metadataFor(['only', 'two'])).resolves.toBeNull();
			await expect(metadataFor({ config: {} })).resolves.toBeNull();
		});

		it('should map every field of a full item', async () => {
			const result = await metadataFor(
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
					tags: [{ tag: 'ml' }, { tag: 'systems' }],
					volume: '12',
					issue: '3',
					pages: '1-10',
					publisher: 'Test Press',
				})
			);

			expect(result).toEqual({
				key: 'FULL1',
				itemType: 'journalArticle',
				title: 'Full Paper',
				creators: ['ACME Consortium', 'Jane Roe', 'Solo', 'Mono', ''],
				date: '2024-05-01',
				publication: 'Journal of Tests',
				doi: '10.1000/xyz',
				url: 'https://example.org/paper',
				abstract: 'An abstract.',
				tags: ['ml', 'systems'],
				zoteroNotes: [],
				volume: '12',
				issue: '3',
				pages: '1-10',
				publisher: 'Test Press',
			});
		});

		it('should apply defaults when optional fields are missing', async () => {
			const result = await metadataFor(exportResult({ key: 'MIN1' }));

			expect(result).toEqual({
				key: 'MIN1',
				itemType: 'unknown',
				title: '',
				creators: [],
				date: '',
				publication: '',
				doi: '',
				url: '',
				abstract: '',
				tags: [],
				zoteroNotes: [],
				volume: undefined,
				issue: undefined,
				pages: undefined,
				publisher: undefined,
			});
		});

		it('should fall back to proceedings title then conference name for publication', async () => {
			const proceedings = await metadataFor(
				exportResult({
					key: 'P1',
					proceedingsTitle: 'Proc. of Tests',
					conferenceName: 'TestConf',
				})
			);
			const conference = await metadataFor(
				exportResult({ key: 'C1', conferenceName: 'TestConf' })
			);

			expect(proceedings?.publication).toBe('Proc. of Tests');
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

		it('should return annotations from attachments', async () => {
			const annotations = await annotationsFor([
				{
					itemKey: 'ABC123',
					title: 'PDF',
					annotations: [
						{
							key: 'ann1',
							annotationType: 'highlight',
							annotationText: 'quote',
							annotationComment: 'note',
							annotationColor: '#yellow',
							annotationPageLabel: '1',
							annotationPosition: { pageIndex: 0 },
							dateAdded: '2024-01-01T00:00:00Z',
						},
					],
				},
			]);

			expect(annotations).toEqual([
				{
					key: 'ann1',
					citationKey: 'doe2020',
					type: 'highlight',
					text: 'quote',
					comment: 'note',
					color: '#yellow',
					pageLabel: '1',
					link: 'zotero://open-pdf/library/items/ABC123?page=1&annotation=ann1',
					attachmentTitle: 'PDF',
					position: { pageIndex: 0 },
					date: '2024-01-01T00:00:00Z',
				},
			]);
		});

		it('should return an empty list when there are no attachments', async () => {
			await expect(annotationsFor(null)).resolves.toEqual([]);
			await expect(annotationsFor([])).resolves.toEqual([]);
		});

		it('should skip attachments without an annotations array', async () => {
			const annotations = await annotationsFor([
				{ itemKey: 'A', title: 'No annotations' },
				{ itemKey: 'B', title: 'Bad annotations', annotations: 'none' },
				{ itemKey: 'C', title: 'Empty annotations', annotations: [] },
				{
					itemKey: 'D',
					title: 'Has one',
					annotations: [{ key: 'd1', annotationType: 'note' }],
				},
			]);

			expect(annotations).toHaveLength(1);
			expect(annotations[0].attachmentTitle).toBe('Has one');
		});

		it('should map annotation types image, ink, note', async () => {
			const annotations = await annotationsFor([
				{
					itemKey: 'X',
					title: 'P',
					annotations: [
						{
							key: 'a1',
							annotationType: 'image',
							annotationPageLabel: '1',
						},
						{ key: 'a2', annotationType: 'ink', annotationPageLabel: '1' },
						{ key: 'a3', annotationType: 'note', annotationPageLabel: '1' },
						{
							key: 'a4',
							annotationType: 'underline',
							annotationPageLabel: '1',
						},
						{ key: 'a5', annotationPageLabel: '1' },
					],
				},
			]);

			expect(annotations.map((a) => a.type)).toEqual([
				'image',
				'ink',
				'note',
				'unknown',
				'unknown',
			]);
		});

		it('should apply defaults for missing text, comment and color', async () => {
			const [annotation] = await annotationsFor([
				{
					itemKey: 'X',
					title: 'P',
					annotations: [{ key: 'a1', annotationType: 'highlight' }],
				},
			]);

			expect(annotation.text).toBe('');
			expect(annotation.comment).toBe('');
			expect(annotation.color).toBe('#aaaaaa');
			expect(annotation.position).toBeUndefined();
			expect(annotation.date).toBe('');
		});

		it('should fall back from page label to page to a question mark', async () => {
			const annotations = await annotationsFor([
				{
					itemKey: 'X',
					title: 'P',
					annotations: [
						{ key: 'a1', annotationPageLabel: 'iv', page: 4 },
						{ key: 'a2', page: 7 },
						{ key: 'a3' },
					],
				},
			]);

			expect(annotations.map((a) => a.pageLabel)).toEqual(['iv', 7, '?']);
			expect(annotations.map((a) => a.link)).toEqual([
				'zotero://open-pdf/library/items/X?page=iv&annotation=a1',
				'zotero://open-pdf/library/items/X?page=7&annotation=a2',
				'zotero://open-pdf/library/items/X?page=?&annotation=a3',
			]);
		});

		it('should fall back across date and position fields', async () => {
			const annotations = await annotationsFor([
				{
					itemKey: 'X',
					title: 'P',
					annotations: [
						{
							key: 'a1',
							dateAdded: 'added',
							dateModified: 'modified',
							date: 'plain',
							annotationPosition: 'ap',
							position: 'p',
						},
						{
							key: 'a2',
							dateModified: 'modified',
							date: 'plain',
							position: 'p',
						},
						{ key: 'a3', date: 'plain' },
					],
				},
			]);

			expect(annotations.map((a) => a.date)).toEqual([
				'added',
				'modified',
				'plain',
			]);
			expect(annotations.map((a) => a.position)).toEqual(['ap', 'p', undefined]);
		});

		it('should build links from the open URL with and without a query string', async () => {
			const annotations = await annotationsFor([
				{
					open: 'zotero://open-pdf/library/items/OPEN1',
					path: '/data/storage/OPEN1/paper.pdf',
					annotations: [{ key: 'a1', annotationPageLabel: '2' }],
				},
				{
					open: 'zotero://open-pdf/groups/5/items/OPEN2?sel=1',
					path: 'C:\\Zotero\\storage\\OPEN2\\slides.pdf',
					annotations: [{ key: 'a2', annotationPageLabel: '3' }],
				},
			]);

			expect(annotations[0].link).toBe(
				'zotero://open-pdf/library/items/OPEN1?page=2&annotation=a1'
			);
			expect(annotations[0].attachmentTitle).toBe('paper.pdf');
			expect(annotations[1].link).toBe(
				'zotero://open-pdf/groups/5/items/OPEN2?sel=1&page=3&annotation=a2'
			);
			expect(annotations[1].attachmentTitle).toBe('slides.pdf');
		});

		it('should derive the item key from the uri when itemKey is missing', async () => {
			const [annotation] = await annotationsFor([
				{
					uri: 'http://zotero.org/users/1/items/URI1',
					annotations: [{ key: 'a1', annotationPageLabel: '1' }],
				},
			]);

			expect(annotation.link).toBe(
				'zotero://open-pdf/library/items/URI1?page=1&annotation=a1'
			);
			expect(annotation.attachmentTitle).toBe('Unknown Attachment');
		});

		it('should leave the item key empty when nothing identifies the attachment', async () => {
			const annotations = await annotationsFor([
				{
					uri: 'http://zotero.org/users/1/items/',
					path: '/trailing/slash/',
					annotations: [{ key: 'a1', page: 1 }],
				},
				{ open: 12, path: '', annotations: [{ key: 'a2', page: 1 }] },
			]);

			expect(annotations[0].link).toBe(
				'zotero://open-pdf/library/items/?page=1&annotation=a1'
			);
			expect(annotations[0].attachmentTitle).toBe('Unknown Attachment');
			expect(annotations[1].link).toBe(
				'zotero://open-pdf/library/items/?page=1&annotation=a2'
			);
			expect(annotations[1].attachmentTitle).toBe('Unknown Attachment');
		});

		it('should resolve the item key from open URLs with or without an items segment', () => {
			const resolve = (att: unknown) =>
				(service as any).resolveAttachmentItemKey(att);

			expect(
				resolve({ open: 'zotero://open-pdf/library/items/KEY9?page=1' })
			).toBe('KEY9');
			expect(
				resolve({
					uri: 'http://zotero.org/items/',
					open: 'zotero://open-pdf/library/items/KEY8#frag',
				})
			).toBe('KEY8');
			expect(resolve({ open: 'zotero://select/library' })).toBeUndefined();
			expect(resolve({})).toBeUndefined();
		});

		it('should default the page to 1 when building a link without a page label', () => {
			const link = (service as any).buildAnnotationLink(null, 'K', '', 'a1');

			expect(link).toBe('zotero://open-pdf/library/items/K?page=1&annotation=a1');
		});
	});
});
