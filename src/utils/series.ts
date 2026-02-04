/**
 * Derive a pure conference series acronym (no year or edition).
 * e.g. "AOSD 2026" -> "AOSD", "CHIL 2026" -> "CHIL", "MODA26" -> "MODA".
 */
export function pureSeriesFromAcronym(acronym: string): string {
	if (!acronym || !acronym.trim()) return '';
	let s = acronym.trim();
	// Remove ordinal suffix: "1st", "2nd", "3rd", "4th", ...
	s = s.replace(/\s+(1st|2nd|3rd|\d+th)$/i, '');
	// Remove trailing space + 2-4 digit year
	s = s.replace(/\s+\d{2,4}$/, '');
	// Remove trailing 2-4 digit year without space (e.g. MODA26)
	s = s.replace(/\d{2,4}$/, '');
	return s.trim() || acronym.trim();
}
