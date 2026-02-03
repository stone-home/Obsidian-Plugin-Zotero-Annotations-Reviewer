import { ZoteroService } from './zotero';
import { requestUrl } from 'obsidian';

jest.mock('obsidian', () => ({
	requestUrl: jest.fn()
}));

describe('ZoteroService', () => {
	let service: ZoteroService;

	beforeAll(() => {
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		jest.spyOn(console, 'error').mockImplementation(() => {});
	});

	// 2. Restore console logs after tests finish (Critical!)
	afterAll(() => {
		jest.restoreAllMocks();
	});

	beforeEach(() => {
		jest.clearAllMocks();
		service = new ZoteroService(23119); // Standard port
	});

	it('should resolve library ID and fetch metadata', async () => {
		// 1. Mock 'user.groups' (Library Map)
		(requestUrl as jest.Mock).mockResolvedValueOnce({
			status: 200,
			text: JSON.stringify({ result: [{ id: 5, name: "My Group" }] })
		});

		// 2. Mock 'item.search' (Find item)
		(requestUrl as jest.Mock).mockResolvedValueOnce({
			status: 200,
			text: JSON.stringify({ result: [{ library: "My Group" }] })
		});

		// 3. Mock 'item.export' (Get Metadata)
		const mockMetadata = {
			items: [{
				key: "XYZ123",
				title: "Test Paper",
				creators: [{ firstName: "John", lastName: "Doe" }]
			}]
		};

		// BBT returns export as a string inside an array
		(requestUrl as jest.Mock).mockResolvedValueOnce({
			status: 200,
			text: JSON.stringify({
				result: ["some-format", "more-data", JSON.stringify(mockMetadata)]
			})
		});

		const result = await service.getItemMetadata('@doe2020');

		expect(result).not.toBeNull();
		expect(result?.title).toBe("Test Paper");
		expect(result?.creators).toContain("John Doe");

		// Verify 3 calls were made
		expect(requestUrl).toHaveBeenCalledTimes(3);
	});

	it('should handle HTTP errors gracefully', async () => {
		(requestUrl as jest.Mock).mockRejectedValue(new Error("Connection refused"));
		await expect(service.getRawMetadata('invalid')).rejects.toThrow("Connection refused");
	});

	it('should return null when getItemMetadata gets no result', async () => {
		(requestUrl as jest.Mock)
			.mockResolvedValueOnce({ status: 200, text: JSON.stringify({ result: [{ library: 'My Library' }] }) })
			.mockResolvedValueOnce({ status: 200, text: JSON.stringify({ result: [{ name: 'My Library', id: 1 }] }) })
			.mockResolvedValueOnce({ status: 200, text: JSON.stringify({ result: null }) });
		const result = await service.getItemMetadata('@nonexistent');
		expect(result).toBeNull();
	});

	it('should return annotations from attachments', async () => {
		(requestUrl as jest.Mock)
			.mockResolvedValueOnce({ status: 200, text: JSON.stringify({ result: [{ library: 'My Library' }] }) })
			.mockResolvedValueOnce({ status: 200, text: JSON.stringify({ result: [{ name: 'My Library', id: 1 }] }) })
			.mockResolvedValueOnce({
				status: 200,
				text: JSON.stringify({
					result: [{
						itemKey: 'ABC123',
						title: 'PDF',
						annotations: [{
							key: 'ann1',
							annotationType: 'highlight',
							annotationText: 'quote',
							annotationComment: 'note',
							annotationColor: '#yellow',
							annotationPageLabel: '1'
						}]
					}]
				})
			});
		const annotations = await service.getAnnotations('@doe2020');
		expect(annotations).toHaveLength(1);
		expect(annotations[0].text).toBe('quote');
		expect(annotations[0].type).toBe('highlight');
	});

	it('should throw when citation key not found in search', async () => {
		(requestUrl as jest.Mock).mockResolvedValueOnce({ status: 200, text: JSON.stringify({ result: [] }) });
		await expect(service.getItemMetadata('@notfound')).rejects.toThrow(/not found/);
	});

	it('should parse item metadata when result is array with JSON in third element', async () => {
		(requestUrl as jest.Mock)
			.mockResolvedValueOnce({ status: 200, text: JSON.stringify({ result: [{ library: 'Lib' }] }) })
			.mockResolvedValueOnce({ status: 200, text: JSON.stringify({ result: [{ name: 'Lib', id: 1 }] }) })
			.mockResolvedValueOnce({
				status: 200,
				text: JSON.stringify({ result: ['format', 'extra', JSON.stringify({ items: [{ title: 'From Array', creators: [], key: 'k', itemType: 'article', date: '', publicationTitle: '', DOI: '', url: '', abstractNote: '', tags: [] }] })] })
			});
		const result = await service.getItemMetadata('@key');
		expect(result?.title).toBe('From Array');
	});

	it('should map annotation types image, ink, note', async () => {
		(requestUrl as jest.Mock)
			.mockResolvedValueOnce({ status: 200, text: JSON.stringify({ result: [{ library: 'L' }] }) })
			.mockResolvedValueOnce({ status: 200, text: JSON.stringify({ result: [{ name: 'L', id: 1 }] }) })
			.mockResolvedValueOnce({
				status: 200,
				text: JSON.stringify({
					result: [{
						itemKey: 'X',
						title: 'P',
						annotations: [
							{ key: 'a1', annotationType: 'image', annotationText: '', annotationComment: '', annotationColor: '', annotationPageLabel: '1' },
							{ key: 'a2', annotationType: 'ink', annotationText: '', annotationComment: '', annotationColor: '', annotationPageLabel: '1' },
							{ key: 'a3', annotationType: 'note', annotationText: '', annotationComment: '', annotationColor: '', annotationPageLabel: '1' }
						]
					}]
				})
			});
		const annotations = await service.getAnnotations('@x');
		expect(annotations).toHaveLength(3);
		expect(annotations[0].type).toBe('image');
		expect(annotations[1].type).toBe('ink');
		expect(annotations[2].type).toBe('note');
	});
});
