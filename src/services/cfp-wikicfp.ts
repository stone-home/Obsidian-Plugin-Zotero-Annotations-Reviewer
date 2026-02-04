import { requestUrl } from 'obsidian';
import { CFPItem } from '../types';
import { pureSeriesFromAcronym } from '../utils/series';

const DELAY_MS = 1500;

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/** Extract text content from HTML, stripping tags. */
function stripHtml(html: string): string {
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Parse a WikiCFP table row. Rows have 4 columns: Event (link+name), When, Where, Deadline. */
function parseWikiCFPTableRow(rowHtml: string, pageUrl: string): CFPItem | null {
	// Match <td>...</td> cells (non-greedy)
	const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
	const cells: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = tdRe.exec(rowHtml)) !== null) {
		cells.push(m[1].trim());
	}
	if (cells.length < 4) return null;

	const eventCell = cells[0];
	const whenCell = cells[1];
	const whereCell = cells[2];
	const deadlineCell = cells[3];

	// Acronym from link text e.g. <a ...>CHIL 2026</a>
	const linkMatch = eventCell.match(/<a[^>]*>([^<]+)<\/a>/i);
	const acronym = linkMatch ? stripHtml(linkMatch[1]).trim() : '';
	const fullName = stripHtml(eventCell.replace(/<a[^>]*>[\s\S]*?<\/a>/i, '')).trim() || acronym;
	if (!acronym && !fullName) return null;

	const submissionDdl = stripHtml(deadlineCell).trim();
	if (!submissionDdl || submissionDdl.toLowerCase() === 'n/a') return null;

	const location = stripHtml(whereCell).trim() || 'N/A';
	let start: string | undefined;
	let end: string | undefined;
	const whenStr = stripHtml(whenCell).trim();
	if (whenStr && whenStr.toLowerCase() !== 'n/a') {
		const range = whenStr.match(/^([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*-\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})$/);
		if (range) {
			start = range[1];
			end = range[2];
		} else {
			start = whenStr;
		}
	}

	const eventAcronym = acronym || fullName.slice(0, 30).replace(/\s+/g, '-');
	return {
		acronym: eventAcronym,
		series: pureSeriesFromAcronym(eventAcronym),
		fullName: fullName || acronym,
		location,
		start,
		end,
		submissionDdl,
		source: 'wikicfp',
		url: pageUrl
	};
}

/** Parse WikiCFP HTML table body. */
function parseWikiCFPHtml(html: string, pageUrl: string): CFPItem[] {
	const items: CFPItem[] = [];
	const seenAcronyms = new Set<string>();
	// Skip header row; match data rows (Event | When | Where | Deadline)
	const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
	let rowMatch: RegExpExecArray | null;
	while ((rowMatch = rowRe.exec(html)) !== null) {
		const rowHtml = rowMatch[1];
		// Skip if row looks like header (e.g. "Event", "When", "Deadline")
		if (/<th[\s>]|Event\s*<\/|When\s*<\/|Where\s*<\/|Deadline\s*<\//i.test(rowHtml)) continue;
		const item = parseWikiCFPTableRow(rowHtml, pageUrl);
		if (item) {
			// Deduplicate by acronym
			const key = item.acronym.toLowerCase();
			if (!seenAcronyms.has(key)) {
				seenAcronyms.add(key);
				items.push(item);
			} else {
				console.log('[CFP] parseWikiCFPHtml: skipping duplicate acronym', item.acronym);
			}
		}
	}
	return items;
}

/**
 * Fetch and parse WikiCFP pages. One URL at a time with delay.
 */
export async function fetchWikiCFP(urls: string[]): Promise<CFPItem[]> {
	const results: CFPItem[] = [];
	for (let i = 0; i < urls.length; i++) {
		const url = urls[i]?.trim();
		if (!url) continue;
		try {
			const resp = await requestUrl({ url, method: 'GET' });
			if (resp.status !== 200) continue;
			const items = parseWikiCFPHtml(resp.text, url);
			results.push(...items);
		} catch {
			// Skip failed URL
		}
		if (i < urls.length - 1) await delay(DELAY_MS);
	}
	return results;
}
