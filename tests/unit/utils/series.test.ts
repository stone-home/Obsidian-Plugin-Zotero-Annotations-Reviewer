import { pureSeriesFromAcronym } from '../../../src/utils/series';

describe('pureSeriesFromAcronym', () => {
	it('strips trailing 4-digit year after single or multiple spaces', () => {
		expect(pureSeriesFromAcronym('AOSD 2026')).toBe('AOSD');
		expect(pureSeriesFromAcronym('AOSD    2026')).toBe('AOSD');
		expect(pureSeriesFromAcronym('CHIL 2026')).toBe('CHIL');
	});

	it('strips trailing 2-digit year without space', () => {
		expect(pureSeriesFromAcronym('MODA26')).toBe('MODA');
	});

	it('strips ordinal suffixes (1st, 2nd, 3rd, Nth)', () => {
		expect(pureSeriesFromAcronym('Conference 1st')).toBe('Conference');
		expect(pureSeriesFromAcronym('Conference 2nd')).toBe('Conference');
		expect(pureSeriesFromAcronym('Conference 3rd')).toBe('Conference');
		expect(pureSeriesFromAcronym('Conference 10th')).toBe('Conference');
		expect(pureSeriesFromAcronym('Conference   24th')).toBe('Conference');
	});

	it('returns trimmed acronym when no year or ordinal is present or when input is pure digits', () => {
		expect(pureSeriesFromAcronym('AAAI')).toBe('AAAI');
		expect(pureSeriesFromAcronym('2026')).toBe('2026');
	});

	it('returns empty string for empty or whitespace-only input', () => {
		expect(pureSeriesFromAcronym('')).toBe('');
		expect(pureSeriesFromAcronym('   ')).toBe('');
	});

	it('completes in linear time on adversarial long-whitespace input', () => {
		const adversarial = 'CONF' + ' '.repeat(50000) + 'X';
		const start = performance.now();
		const result = pureSeriesFromAcronym(adversarial);
		const elapsed = performance.now() - start;
		expect(result).toBe('CONF X');
		expect(elapsed).toBeLessThan(100);
	});
});
