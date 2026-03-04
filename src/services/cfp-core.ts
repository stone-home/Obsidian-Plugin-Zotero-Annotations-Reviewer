import { CFPRank } from '../types';

/**
 * Minimal representation of a CORE CSV row.
 *
 * The CSV is expected to have columns:
 *   0: id
 *   1: Conference name
 *   2: Acronym
 *   3: Collection (e.g. ICORE2026)
 *   4: Rank (A*, A, B, C, Unranked, journal published, ...)
 * Remaining columns are ignored.
 */
export interface CoreCsvEntry {
	name: string;
	acronym: string;
	collection: string;
	rankRaw: string;
}

export interface CoreRankIndex {
	byAcronym: Map<string, CoreCsvEntry[]>;
	byName: Map<string, CoreCsvEntry[]>;
}

type CoreLetter = CFPRank['coreLetter'];

const CORE_LETTERS: CoreLetter[] = ['A*', 'A', 'B', 'C'];

function normName(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function normAcronym(s: string): string {
	return s.replace(/\s+/g, '').toUpperCase();
}

/**
 * Lightweight CSV line parser that supports quoted cells and commas inside quotes.
 * This is sufficient for the CORE CSV format.
 */
function parseCsvLine(line: string): string[] {
	const result: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				// Escaped quote
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (ch === ',' && !inQuotes) {
			result.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	result.push(current);
	return result;
}

/** Build an in-memory index from the contents of a CORE.csv file. */
export function parseCoreCsv(text: string): CoreRankIndex {
	const byAcronym = new Map<string, CoreCsvEntry[]>();
	const byName = new Map<string, CoreCsvEntry[]>();

	const lines = text.split(/\r?\n/);
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) continue;

		const cols = parseCsvLine(line);
		if (cols.length < 5) continue;

		// Heuristic: skip header row if present (Conference name / Acronym etc.).
		if (cols[0].toLowerCase().includes('id') && cols[1].toLowerCase().includes('conference')) {
			continue;
		}

		const name = (cols[1] ?? '').toString().trim();
		const acronym = (cols[2] ?? '').toString().trim();
		const collection = (cols[3] ?? '').toString().trim();
		const rankRaw = (cols[4] ?? '').toString().trim();

		if (!name && !acronym) continue;

		const entry: CoreCsvEntry = { name, acronym, collection, rankRaw };

		const aKey = normAcronym(acronym || name);
		if (!byAcronym.has(aKey)) byAcronym.set(aKey, []);
		byAcronym.get(aKey)!.push(entry);

		const nKey = normName(name || acronym);
		if (!byName.has(nKey)) byName.set(nKey, []);
		byName.get(nKey)!.push(entry);
	}

	return { byAcronym, byName };
}

export interface CoreRankForSeries {
	coreLetter?: CoreLetter;
	coreStatus?: string;
	collection?: string;
}

/** Derive the best CORE rank for a given series name using a pre-built index. */
export function getCoreRankForSeries(index: CoreRankIndex, seriesName: string): CoreRankForSeries | null {
	const raw = seriesName?.trim();
	if (!raw) return null;

	// Strip trailing year if present: e.g. "AAAI 2026" -> "AAAI"
	const base = raw.replace(/\s+(19|20)\d{2}\b/, '');
	const acrKey = normAcronym(base);
	const nameKey = normName(base);

	let candidates: CoreCsvEntry[] = [];

	// 1) Try acronym-based lookup.
	if (index.byAcronym.has(acrKey)) {
		candidates = index.byAcronym.get(acrKey)!;
	}

	// 2) Fallback to exact name match.
	if (candidates.length === 0 && index.byName.has(nameKey)) {
		candidates = index.byName.get(nameKey)!;
	}

	if (candidates.length === 0) return null;

	// Prefer entries that actually carry a clear A*/A/B/C letter.
	let best: CoreCsvEntry | null = null;
	for (const entry of candidates) {
		const letter = normaliseCoreLetter(entry.rankRaw);
		if (letter) {
			best = entry;
			break;
		}
	}
	if (!best) {
		// No letter grade among candidates; fall back to the first entry.
		best = candidates[0];
	}

	const letter = normaliseCoreLetter(best.rankRaw);
	const result: CoreRankForSeries = {
		coreLetter: letter,
		collection: best.collection || undefined
	};
	if (!letter && best.rankRaw) {
		result.coreStatus = best.rankRaw;
	}
	return result;
}

function normaliseCoreLetter(rankRaw: string): CoreLetter | undefined {
	const trimmed = rankRaw?.trim();
	if (!trimmed) return undefined;
	const upper = trimmed.toUpperCase();
	for (const l of CORE_LETTERS) {
		if (upper === l) return l;
	}
	return undefined;
}

