import { requestUrl } from 'obsidian';
import { CFPItem } from '../types';
import { pureSeriesFromAcronym } from '../utils/series';

const DELAY_MS = 1500;

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function stripHtml(html: string): string {
	return html
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
}

/** OpenResearch events: Acronym, City, Country, Name, Start date, End date, Submission deadline. */
function parseOpenresearchRow(rowHtml: string, pageUrl: string): CFPItem | null {
	const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
	const cells: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = tdRe.exec(rowHtml)) !== null) {
		cells.push(m[1].trim());
	}
	// Acronym, City, Country, Name, Start, End, Submission deadline
	if (cells.length < 4) return null;

	const acronym = stripHtml(cells[0]).trim();
	const city = stripHtml(cells[1]).trim();
	const country = stripHtml(cells[2]).trim();
	const fullName = stripHtml(cells[3]).trim();
	const location = [city, country].filter(Boolean).join(', ') || 'N/A';

	let start: string | undefined;
	let end: string | undefined;
	let submissionDdl: string | undefined;
	if (cells.length >= 5) start = stripHtml(cells[4]).trim() || undefined;
	if (cells.length >= 6) end = stripHtml(cells[5]).trim() || undefined;
	if (cells.length >= 7) submissionDdl = stripHtml(cells[6]).trim();

	if (!acronym && !fullName) return null;
	if (!submissionDdl) submissionDdl = 'N/A';

	const eventAcronym = acronym || fullName.slice(0, 30).replace(/\s+/g, '-');
	return {
		acronym: eventAcronym,
		series: pureSeriesFromAcronym(eventAcronym),
		fullName: fullName || acronym,
		location,
		start,
		end,
		submissionDdl,
		source: 'openresearch',
		url: pageUrl
	};
}

function parseOpenresearchHtml(html: string, pageUrl: string): CFPItem[] {
	const items: CFPItem[] = [];
	const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
	let rowMatch: RegExpExecArray | null;
	while ((rowMatch = rowRe.exec(html)) !== null) {
		const rowHtml = rowMatch[1];
		if (/<th[\s>]|Acronym\s*<\/|City\s*<\/|Country\s*<\/|Name\s*<\/|Start\s*<\/|End\s*<\/|Submission\s*<\//i.test(rowHtml)) continue;
		const item = parseOpenresearchRow(rowHtml, pageUrl);
		if (item) items.push(item);
	}
	return items;
}

export async function fetchOpenresearch(urls: string[]): Promise<CFPItem[]> {
	const results: CFPItem[] = [];
	for (let i = 0; i < urls.length; i++) {
		const url = urls[i]?.trim();
		if (!url) continue;
		try {
			const resp = await requestUrl({ url, method: 'GET' });
			if (resp.status !== 200) continue;
			const items = parseOpenresearchHtml(resp.text, url);
			results.push(...items);
		} catch {
			// Skip failed URL
		}
		if (i < urls.length - 1) await delay(DELAY_MS);
	}
	return results;
}
