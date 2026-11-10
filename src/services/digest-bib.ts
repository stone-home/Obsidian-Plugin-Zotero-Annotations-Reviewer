import { validateInput } from './digest-import';
import { DigestInput } from './digest-types';

/** One entry read from a BibTeX file. Field names are lower-cased. */
export type BibEntry = {
	type: string;
	citekey: string;
	fields: Record<string, string>;
};

const SKIPPED_ENTRY_TYPES = new Set(['comment', 'string', 'preamble']);
const ARXIV_DOI_PREFIX = '10.48550/arXiv.';

const ITEM_TYPES: Record<string, string> = {
	article: 'journalArticle',
	inproceedings: 'conferencePaper',
	conference: 'conferencePaper',
	proceedings: 'book',
	book: 'book',
	incollection: 'bookSection',
	inbook: 'bookSection',
	phdthesis: 'thesis',
	mastersthesis: 'thesis',
	techreport: 'report',
};

/** Index just past the brace group that opens at `open`, honouring nesting. */
function skipBraces(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const ch = text[i];
		if (ch === '\\') i++;
		else if (ch === '{') depth++;
		else if (ch === '}' && --depth === 0) return i + 1;
	}
	return text.length;
}

/** Reads one field value starting at `start`; `#` concatenation is joined. */
function readValue(text: string, start: number): { value: string; end: number } {
	let i = start;
	const parts: string[] = [];
	for (;;) {
		while (i < text.length && /\s/.test(text[i])) i++;
		if (text[i] === '{') {
			const end = skipBraces(text, i);
			parts.push(text.slice(i + 1, end - 1));
			i = end;
		} else if (text[i] === '"') {
			let j = i + 1;
			let depth = 0;
			while (j < text.length && (text[j] !== '"' || depth > 0)) {
				if (text[j] === '\\') j++;
				else if (text[j] === '{') depth++;
				else if (text[j] === '}') depth--;
				j++;
			}
			parts.push(text.slice(i + 1, j));
			i = j + 1;
		} else {
			let j = i;
			while (j < text.length && !/[,}#\s]/.test(text[j])) j++;
			parts.push(text.slice(i, j));
			i = j;
		}
		while (i < text.length && /\s/.test(text[i])) i++;
		if (text[i] !== '#') break;
		i++;
	}
	return { value: parts.join(''), end: i };
}

function parseFields(body: string): Record<string, string> {
	const fields: Record<string, string> = {};
	let i = 0;
	while (i < body.length) {
		const match = /[A-Za-z][\w-]*/.exec(body.slice(i));
		if (!match) break;
		let cursor = i + match.index + match[0].length;
		while (cursor < body.length && /\s/.test(body[cursor])) cursor++;
		if (body[cursor] !== '=') {
			i = cursor + 1;
			continue;
		}
		const { value, end } = readValue(body, cursor + 1);
		fields[match[0].toLowerCase()] = value;
		i = end + 1;
	}
	return fields;
}

/**
 * Reads the entries of a BibTeX document. Only the structure needed for
 * identifier and display fields is handled; `@comment`, `@string` and
 * `@preamble` blocks are ignored.
 */
export function parseBibEntries(text: string): BibEntry[] {
	const entries: BibEntry[] = [];
	const header = /@([A-Za-z]+)\s*\{/g;
	let match: RegExpExecArray | null;
	while ((match = header.exec(text)) !== null) {
		const open = match.index + match[0].length - 1;
		const end = skipBraces(text, open);
		header.lastIndex = end;
		const type = match[1].toLowerCase();
		if (SKIPPED_ENTRY_TYPES.has(type)) continue;
		const body = text.slice(open + 1, end - 1);
		const comma = body.indexOf(',');
		if (comma === -1) continue;
		entries.push({
			type,
			citekey: body.slice(0, comma).trim(),
			fields: parseFields(body.slice(comma + 1)),
		});
	}
	return entries;
}

/** Reduces simple LaTeX markup to plain text for display on a card. */
export function cleanLatex(value: string): string {
	return value
		.replace(/\\([&%$#_])/g, '$1')
		.replace(/\\[`'^"~=.]\s*\{?(\\?[A-Za-z])\}?/g, '$1')
		.replace(/\\[A-Za-z]+\s*\{([^{}]*)\}/g, '$1')
		.replace(/\\[A-Za-z]+\s*/g, '')
		.replace(/[{}]/g, '')
		.replace(/~/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function bareDoi(value: string): string {
	return value
		.trim()
		.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
		.replace(/^doi:\s*/i, '');
}

function arxivId(fields: Record<string, string>): string | undefined {
	const archive = (fields.archiveprefix ?? fields.eprinttype ?? '').toLowerCase();
	if (archive !== 'arxiv' || !fields.eprint) return undefined;
	const id = fields.eprint
		.trim()
		.replace(/^arxiv:/i, '')
		.replace(/v\d+$/i, '');
	return id || undefined;
}

/**
 * Converts one BibTeX entry to a digest paper.
 * @returns undefined when the entry has no DOI, arXiv id or URL to use as key.
 */
export function bibEntryToInput(entry: BibEntry): DigestInput | undefined {
	const { fields } = entry;
	const arxiv = arxivId(fields);
	const doi = fields.doi
		? bareDoi(fields.doi)
		: arxiv
			? ARXIV_DOI_PREFIX + arxiv
			: '';
	const url =
		(fields.url ?? '').trim() || (arxiv ? `https://arxiv.org/abs/${arxiv}` : '');
	const key = doi || url;
	if (!key) return undefined;

	const isArxiv = doi.toLowerCase().startsWith(ARXIV_DOI_PREFIX.toLowerCase());
	const candidate: Record<string, unknown> = {
		key,
		title: cleanLatex(fields.title ?? '') || entry.citekey,
		item_type: isArxiv ? 'preprint' : (ITEM_TYPES[entry.type] ?? 'document'),
	};
	if (doi) candidate.doi = doi;
	if (url) candidate.url = url;
	const year = Number.parseInt(fields.year ?? '', 10);
	if (Number.isInteger(year)) candidate.year = year;
	const venue = cleanLatex(fields.journal ?? fields.booktitle ?? '');
	if (venue) candidate.venue = venue;
	const abstract = cleanLatex(fields.abstract ?? '');
	if (abstract) candidate.abstract = abstract;

	const checked = validateInput(candidate);
	return checked.ok ? checked.input : undefined;
}

/**
 * Converts a BibTeX document to digest papers.
 * @returns the converted papers and the number of entries skipped because
 * they carry no usable identifier.
 */
export function bibToInputs(text: string): { inputs: DigestInput[]; skipped: number } {
	const inputs: DigestInput[] = [];
	let skipped = 0;
	for (const entry of parseBibEntries(text)) {
		const input = bibEntryToInput(entry);
		if (input) inputs.push(input);
		else skipped++;
	}
	return { inputs, skipped };
}
