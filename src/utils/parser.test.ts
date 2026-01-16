import { parseImageMap } from './parser';

describe('Parser Utils', () => {
	beforeAll(() => {
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		jest.spyOn(console, 'error').mockImplementation(() => {});
	});

	// 2. Restore console logs after tests finish (Critical!)
	afterAll(() => {
		jest.restoreAllMocks();
	});

	describe('parseImageMap', () => {
		it('should return empty object for empty input', () => {
			expect(parseImageMap('')).toEqual({});
			expect(parseImageMap('   ')).toEqual({});
		});

		it('should parse valid standard JSON', () => {
			const input = '{"key": "value", "num": 123}';
			expect(parseImageMap(input)).toEqual({ key: 'value', num: 123 });
		});

		it('should sanitize and parse JSON with Windows paths', () => {
			// "C:\Users\Name" is invalid JSON because single backslash escapes 'U'.
			// The parser should fix this to "C:\\Users\\Name"
			const input = '{"path": "C:\\Users\\Name\\image.png"}';

			expect(parseImageMap(input)).toEqual({
				path: 'C:\\Users\\Name\\image.png'
			});
		});

		it('should throw error for truly malformed JSON', () => {
			const input = '{ key: "missing quotes" }'; // Invalid JSON
			expect(() => parseImageMap(input)).toThrow();
		});
	});
});
