import { pureSeriesFromAcronym } from './series';

describe('series', () => {
	describe('pureSeriesFromAcronym', () => {
		it('strips trailing 4-digit year', () => {
			expect(pureSeriesFromAcronym('AOSD 2026')).toBe('AOSD');
			expect(pureSeriesFromAcronym('CHIL 2026')).toBe('CHIL');
		});
		it('strips trailing 2-digit year without space', () => {
			expect(pureSeriesFromAcronym('MODA26')).toBe('MODA');
		});
		it('strips ordinal suffix', () => {
			expect(pureSeriesFromAcronym('Conference 1st')).toBe('Conference');
			expect(pureSeriesFromAcronym('Conference 2nd')).toBe('Conference');
			expect(pureSeriesFromAcronym('Conference 10th')).toBe('Conference');
		});
		it('returns trimmed acronym when no year/ordinal', () => {
			expect(pureSeriesFromAcronym('AAAI')).toBe('AAAI');
		});
		it('handles empty string', () => {
			expect(pureSeriesFromAcronym('')).toBe('');
			expect(pureSeriesFromAcronym('   ')).toBe('');
		});
	});
});
