import { requestUrl } from 'obsidian';
import { fetchWikiCFP } from './cfp-wikicfp';
import { CFPItem } from '../types';

const WIKICFP_BASE = 'http://www.wikicfp.com';
const WIKICFP_SERIES_BASE = 'http://www.wikicfp.com/cfp/series?t=c&i=';
const INDEX_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Random delay between 5 and 10 seconds (ms). */
export function randomDelayMs(): number {
	return 5000 + Math.random() * 5000;
}

export function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/** Strip basic HTML tags & entities – lighter version for series tables. */
export function stripHtmlLite(html: string): string {
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

export interface WikiCFPSeriesEntry {
	id: string;
	seriesAcronym: string;
	fullName: string;
	programUrl: string;
}

/** Parse series index page HTML for links like /cfp/program?id=187&s=AOSD&f=... */
function parseSeriesIndexPage(html: string): WikiCFPSeriesEntry[] {
	const results: WikiCFPSeriesEntry[] = [];
	const re = /\/cfp\/program\?id=(\d+)&s=([^&"']+)(?:&f=([^"']*))?/gi;
	let m: RegExpExecArray | null;
	const seen = new Set<string>();
	while ((m = re.exec(html)) !== null) {
		const id = m[1];
		const s = decodeURIComponent((m[2] ?? '').replace(/\+/g, ' ')).trim();
		const f = (m[3] != null ? decodeURIComponent(m[3].replace(/\+/g, ' ')).trim() : '') || s;
		const key = id + '|' + s;
		if (seen.has(key)) continue;
		seen.add(key);
		results.push({
			id,
			seriesAcronym: s,
			fullName: f,
			programUrl: `http://www.wikicfp.com/cfp/program?id=${id}&s=${encodeURIComponent(s)}&f=${encodeURIComponent(f)}`
		});
	}
	return results;
}

/**
 * Parse a series program page for links to individual event/call pages.
 * Supports: /cfp/servlet/event.showcfp?eventid=123, /cfp/call?cid=..., and relative paths.
 */
function parseProgramPageForEventUrls(html: string): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();
	// event.showcfp?eventid=123
	const eventIdRe = /href\s*=\s*["']?(?:\/cfp\/servlet\/event\.showcfp\?eventid=(\d+)[^"']*|([^"']*event\.showcfp\?eventid=(\d+)))/gi;
	let m: RegExpExecArray | null;
	while ((m = eventIdRe.exec(html)) !== null) {
		const id = m[1] || m[3];
		if (id && !seen.has(id)) {
			seen.add(id);
			urls.push(`${WIKICFP_BASE}/cfp/servlet/event.showcfp?eventid=${id}`);
		}
	}
	// cid= (call id) e.g. /cfp/call?cid=xxx
	const cidRe = /href\s*=\s*["']?(?:\/cfp\/call\?cid=([^&"'\s]+)|([^"']*cfp\/call\?cid=([^&"'\s]+)))/gi;
	while ((m = cidRe.exec(html)) !== null) {
		const cid = m[1] || m[3];
		if (cid && !seen.has('cid:' + cid)) {
			seen.add('cid:' + cid);
			urls.push(`${WIKICFP_BASE}/cfp/call?cid=${encodeURIComponent(cid)}`);
		}
	}
	return urls;
}

/**
 * Fetch WikiCFP Conf Series index pages A–Z with 5–10s random delay between pages.
 * Returns list of series (id, acronym, fullName, programUrl).
 * @param letters Array of letters to fetch (e.g. ['A', 'B']). Empty array means all A-Z.
 */
export async function fetchWikiCFPSeriesIndex(
	onProgress?: (letter: string, count: number) => void,
	letters?: string[]
): Promise<WikiCFPSeriesEntry[]> {
	const all: WikiCFPSeriesEntry[] = [];
	const seen = new Set<string>();
	const lettersToFetch = (letters && letters.length > 0) ? letters : INDEX_LETTERS;

	for (let i = 0; i < lettersToFetch.length; i++) {
		const letter = lettersToFetch[i];
		const url = WIKICFP_SERIES_BASE + letter;
		try {
			const resp = await requestUrl({ url, method: 'GET' });
			if (resp.status !== 200) continue;
			const entries = parseSeriesIndexPage(resp.text);
			let added = 0;
			for (const e of entries) {
				const key = e.id + '|' + e.seriesAcronym;
				if (seen.has(key)) continue;
				seen.add(key);
				all.push(e);
				added++;
			}
			onProgress?.(letter, all.length);
		} catch {
			// Skip failed page
		}
		if (i < INDEX_LETTERS.length - 1) {
			await delay(randomDelayMs());
		}
	}
	return all;
}

/**
 * Parse the "All CFPs on WikiCFP" table on a series program page.
 * This table has 4 columns: Event | When | Where | Deadline.
 * We treat this as the primary, low-noise source for series events.
 */
export function parseSeriesTableToItems(html: string, programUrl: string, seriesAcronym: string): CFPItem[] {
	const items: CFPItem[] = [];
	const seen = new Set<string>();

	// Heuristic: focus on the first table that comes after the "All CFPs on WikiCFP" heading.
	let searchFrom = html.indexOf('All CFPs on WikiCFP');
	if (searchFrom === -1) searchFrom = 0;
	const slice = html.slice(searchFrom);
	const tableMatch = slice.match(/<table[^>]*>[\s\S]*?<\/table>/i);
	if (!tableMatch) return [];
	const tableHtml = tableMatch[0];

	// Extract all <tr> blocks first so we can handle rowspan-based two-row structures.
	const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
	const rows: string[] = [];
	let rowMatch: RegExpExecArray | null;
	while ((rowMatch = rowRe.exec(tableHtml)) !== null) {
		const rowHtml = rowMatch[1];
		// Skip header rows that contain column titles.
		if (/(Event|When|Where|Deadline)\s*<\/(?:th|td)>/i.test(rowHtml)) continue;
		rows.push(rowHtml);
	}

	// Helper to extract <td> contents from a row.
	const extractTds = (rowHtml: string): string[] => {
		const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
		const cells: string[] = [];
		let tdMatch: RegExpExecArray | null;
		while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
			cells.push(tdMatch[1].trim());
		}
		return cells;
	};

	for (let i = 0; i < rows.length; i++) {
		let rowHtml = rows[i];
		let eventCell: string;
		let whenCell: string;
		let whereCell: string;
		let deadlineCell: string;

		let cells = extractTds(rowHtml);

		// WAIFI-style layout: first data row uses rowspan and only has Event + description,
		// second row has dates + where + deadline. Merge them into a single logical row.
		if (cells.length === 2 && /rowspan\s*=\s*["']?2/i.test(rowHtml) && i + 1 < rows.length) {
			const nextCells = extractTds(rows[i + 1]);
			if (nextCells.length >= 3) {
				eventCell = cells[0];
				// Combine description + dates for the "When" cell.
				whenCell = cells[1] + '<br>' + nextCells[0];
				whereCell = nextCells[1];
				deadlineCell = nextCells[2];
				// Skip the next row since we've consumed it.
				i++;
			} else {
				continue;
			}
		} else {
			if (cells.length < 4) continue;
			eventCell = cells[0];
			whenCell = cells[1];
			whereCell = cells[2];
			deadlineCell = cells[3];
		}

		// Event acronym from link text.
		const linkMatch = eventCell.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
		const acronym = linkMatch ? stripHtmlLite(linkMatch[1]) : stripHtmlLite(eventCell);
		if (!acronym) continue;

		// When: often contains "Full name ... <br> Jul 13, 2016 - Jul 15, 2016"
		const whenText = stripHtmlLite(whenCell);
		let fullName = stripHtmlLite(eventCell);
		let start: string | undefined;
		let end: string | undefined;

		if (whenText && whenText.toLowerCase() !== 'n/a') {
			const rangeMatch = whenText.match(/([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*-\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/);
			if (rangeMatch) {
				start = rangeMatch[1];
				end = rangeMatch[2];
				// Take everything before the range as full name if it looks non-empty.
				const before = whenText.slice(0, rangeMatch.index).trim();
				if (before) fullName = before;
			} else {
				start = whenText;
			}
		}

		const submissionDdl = stripHtmlLite(deadlineCell);
		if (!submissionDdl || submissionDdl.toLowerCase() === 'n/a') continue;

		const location = stripHtmlLite(whereCell) || 'N/A';

		const key = acronym.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);

		items.push({
			acronym,
			series: seriesAcronym,
			fullName: fullName || acronym,
			location,
			start,
			end,
			submissionDdl,
			source: 'wikicfp',
			url: programUrl
		});
	}

	return items;
}

/**
 * Fetch events for one series.
 *
 * Strategy:
 * 1) First, parse the "All CFPs on WikiCFP" table on the program page (primary source).
 * 2) If that fails (older/irregular layouts), fall back to crawling individual event URLs.
 */
export async function fetchSeriesEvents(
	programUrl: string,
	seriesAcronym: string,
	onProgress?: (msg: string) => void
): Promise<CFPItem[]> {
	const resp = await requestUrl({ url: programUrl, method: 'GET' });
	if (resp.status !== 200) {
		console.warn('[CFP] fetchSeriesEvents: failed to fetch program page', resp.status);
		return [];
	}
	// 1) Try direct table parsing first (handles WAIFI/ZEUS/XP style pages).
	const tableItems = parseSeriesTableToItems(resp.text, programUrl, seriesAcronym);
	if (tableItems.length > 0) {
		console.log('[CFP] fetchSeriesEvents: parsed', tableItems.length, 'items from series table');
		return tableItems;
	}

	// 2) Fallback: extract individual event URLs and parse with generic WikiCFP parser.
	const eventUrls = parseProgramPageForEventUrls(resp.text);
	console.log('[CFP] fetchSeriesEvents: found', eventUrls.length, 'event URLs from program page');
	if (eventUrls.length === 0) {
		// Last-resort fallback – treat the whole page as a generic WikiCFP table.
		console.log('[CFP] fetchSeriesEvents: no event URLs found, parsing program page via fetchWikiCFP fallback');
		const fromTable = await fetchWikiCFP([programUrl]);
		console.log('[CFP] fetchSeriesEvents: parsed', fromTable.length, 'items from fallback table');
		return fromTable.map(item => ({ ...item, series: item.series || seriesAcronym }));
	}
	const all: CFPItem[] = [];
	const seenAcronyms = new Set<string>();
	for (let i = 0; i < eventUrls.length; i++) {
		onProgress?.(`Event ${i + 1}/${eventUrls.length}`);
		try {
			const items = await fetchWikiCFP([eventUrls[i]]);
			for (const item of items) {
				// Deduplicate by acronym
				const key = item.acronym.toLowerCase();
				if (seenAcronyms.has(key)) {
					console.log('[CFP] fetchSeriesEvents: skipping duplicate acronym', item.acronym);
					continue;
				}
				seenAcronyms.add(key);
				all.push({ ...item, series: item.series || seriesAcronym });
			}
		} catch (e) {
			console.warn('[CFP] fetchSeriesEvents: failed to fetch event URL', eventUrls[i], e);
			// skip failed event page
		}
		if (i < eventUrls.length - 1) {
			await delay(800);
		}
	}
	console.log('[CFP] fetchSeriesEvents: returning', all.length, 'unique events');
	return all;
}
