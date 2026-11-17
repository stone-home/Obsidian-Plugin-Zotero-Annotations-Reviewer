import { parseImageMap } from '../../../src/utils/parser';

describe('parseImageMap', () => {
	let warnSpy: jest.SpyInstance;
	let errorSpy: jest.SpyInstance;

	beforeEach(() => {
		warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
		errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('returns an empty object for empty or whitespace-only input', () => {
		expect(parseImageMap('')).toEqual({});
		expect(parseImageMap('   \n\t  ')).toEqual({});
	});

	it('parses valid standard JSON without warnings', () => {
		const input =
			'{"ann1": "attachments/img1.png", "ann2": "attachments/img2.png"}';
		expect(parseImageMap(input)).toEqual({
			ann1: 'attachments/img1.png',
			ann2: 'attachments/img2.png',
		});
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('sanitizes unescaped Windows backslashes and parses on second attempt', () => {
		const input = '{"path": "C:\\Users\\Name\\image.png"}';
		expect(parseImageMap(input)).toEqual({
			path: 'C:\\Users\\Name\\image.png',
		});
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it('logs fatal error and throws when JSON remains invalid after sanitization', () => {
		const input = '{ key: "missing quotes" }';
		expect(() => parseImageMap(input)).toThrow();
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});
});
