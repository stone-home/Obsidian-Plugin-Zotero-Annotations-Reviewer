import { DigestStore } from './digest-store';
import { DigestFiles, DigestInput } from './digest-types';

const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;
const URL_PATTERN = /^https?:\/\/\S+$/i;
const OPTIONAL_STRINGS = ['venue', 'abstract', 'item_type'] as const;

/** Outcome of checking one candidate paper. */
export type DigestValidation =
	{ ok: true; input: DigestInput } | { ok: false; reason: string };

/** Counts reported after an import. */
export type DigestImportSummary = {
	files: number;
	added: number;
	duplicates: number;
	invalid: number;
};

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

/**
 * Checks a candidate paper against the input contract. Values are checked,
 * never converted: the writer is responsible for supplying them in the agreed
 * form.
 */
export function validateInput(candidate: unknown): DigestValidation {
	if (
		typeof candidate !== 'object' ||
		candidate === null ||
		Array.isArray(candidate)
	) {
		return { ok: false, reason: 'Not a JSON object' };
	}
	const raw = candidate as Record<string, unknown>;
	if (!isNonEmptyString(raw.key)) return { ok: false, reason: 'Missing key' };
	if (!isNonEmptyString(raw.title)) return { ok: false, reason: 'Missing title' };

	const input: DigestInput = { key: raw.key.trim(), title: raw.title.trim() };

	if (raw.doi !== undefined && raw.doi !== null && raw.doi !== '') {
		if (typeof raw.doi !== 'string' || !DOI_PATTERN.test(raw.doi)) {
			return { ok: false, reason: 'doi is not a bare DOI (10.xxxx/...)' };
		}
		input.doi = raw.doi;
	}
	if (raw.url !== undefined && raw.url !== null && raw.url !== '') {
		if (typeof raw.url !== 'string' || !URL_PATTERN.test(raw.url)) {
			return { ok: false, reason: 'url is not an absolute http(s) URL' };
		}
		input.url = raw.url;
	}
	if (raw.year !== undefined && raw.year !== null) {
		if (typeof raw.year !== 'number' || !Number.isInteger(raw.year)) {
			return { ok: false, reason: 'year is not an integer' };
		}
		input.year = raw.year;
	}
	for (const field of OPTIONAL_STRINGS) {
		const value = raw[field];
		if (value === undefined || value === null) continue;
		if (typeof value !== 'string') {
			return { ok: false, reason: `${field} is not a string` };
		}
		if (value !== '') input[field] = value;
	}
	return { ok: true, input };
}

/**
 * Adds papers to the store, skipping duplicates.
 * @returns how many were added and how many were duplicates.
 */
export function ingest(
	store: DigestStore,
	inputs: DigestInput[],
	batch?: string
): { added: number; duplicates: number } {
	let added = 0;
	for (const input of inputs) {
		if (store.add(input, batch)) added++;
	}
	return { added, duplicates: inputs.length - added };
}

/**
 * Imports the lines of one JSONL document into the store. Lines that fail
 * validation are kept in the store's invalid list.
 */
export function importJsonl(
	store: DigestStore,
	text: string,
	file: string
): Omit<DigestImportSummary, 'files'> {
	const summary = { added: 0, duplicates: 0, invalid: 0 };
	for (const line of text.split(/\r?\n/)) {
		if (line.trim() === '') continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			store.addInvalid(line, 'Not valid JSON', file);
			summary.invalid++;
			continue;
		}
		const result = validateInput(parsed);
		if (!result.ok) {
			store.addInvalid(line, result.reason, file);
			summary.invalid++;
		} else if (store.add(result.input)) {
			summary.added++;
		} else {
			summary.duplicates++;
		}
	}
	return summary;
}

/**
 * Imports every `*.jsonl` file of the incoming folder. Each file is removed
 * only after its contents have been saved to the store, so an interrupted
 * import loses nothing and a repeated one is absorbed by deduplication.
 */
export async function importIncoming(
	files: DigestFiles,
	store: DigestStore,
	folder: string
): Promise<DigestImportSummary> {
	const total: DigestImportSummary = {
		files: 0,
		added: 0,
		duplicates: 0,
		invalid: 0,
	};
	if (!(await files.exists(folder))) {
		await files.mkdir(folder);
		return total;
	}
	const paths = (await files.list(folder))
		.filter((path) => path.toLowerCase().endsWith('.jsonl'))
		.sort();
	for (const path of paths) {
		const text = await files.read(path);
		const name = path.split('/').pop() ?? path;
		const summary = importJsonl(store, text, name);
		await store.save();
		await files.remove(path);
		total.files++;
		total.added += summary.added;
		total.duplicates += summary.duplicates;
		total.invalid += summary.invalid;
	}
	return total;
}
