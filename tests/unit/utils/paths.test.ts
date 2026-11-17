import { normalizePath } from '../../../src/utils/paths';

describe('normalizePath', () => {
	it('returns an empty string for empty or undefined input', () => {
		expect(normalizePath('')).toBe('');
		// @ts-expect-error testing runtime guard against undefined input
		expect(normalizePath(undefined)).toBe('');
	});

	it('converts backslashes and collapses duplicate slashes', () => {
		expect(normalizePath('CFP\\OSDI\\\\OSDI 2026.md')).toBe(
			'CFP/OSDI/OSDI 2026.md'
		);
		expect(normalizePath('CFP//OSDI///note.md')).toBe('CFP/OSDI/note.md');
	});

	it('strips a leading "./"', () => {
		expect(normalizePath('./CFP/note.md')).toBe('CFP/note.md');
	});

	it('strips leading slashes after collapsing duplicates', () => {
		expect(normalizePath('/CFP/note.md')).toBe('CFP/note.md');
		expect(normalizePath('//CFP/note.md')).toBe('CFP/note.md');
	});

	it('leaves vault-relative paths and trailing slashes unchanged', () => {
		expect(normalizePath('CFP/note.md')).toBe('CFP/note.md');
		expect(normalizePath('CFP/')).toBe('CFP/');
	});
});
