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
});
