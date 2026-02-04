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

/** EasyChair area page: table with Acronym, Name, Location, Submission deadline, Start date, Topics. */
function parseEasychairRow(rowHtml: string, pageUrl: string): CFPItem | null {
	const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
	const cells: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = tdRe.exec(rowHtml)) !== null) {
		cells.push(m[1].trim());
	}
	// Expect at least Acronym, Name, Location, Submission deadline
	if (cells.length < 4) return null;

	const acronym = stripHtml(cells[0]).trim();
	const fullName = stripHtml(cells[1]).trim();
	const location = stripHtml(cells[2]).trim();
	const submissionDdl = stripHtml(cells[3]).trim();
	if (!acronym && !fullName) return null;
	if (!submissionDdl) return null;

	let start: string | undefined;
	if (cells.length >= 5) start = stripHtml(cells[4]).trim() || undefined;

	const eventAcronym = acronym || fullName.slice(0, 30).replace(/\s+/g, '-');
	return {
		acronym: eventAcronym,
		series: pureSeriesFromAcronym(eventAcronym),
		fullName: fullName || acronym,
		location: location || 'N/A',
		start,
		end: undefined,
		submissionDdl,
		source: 'easychair',
		url: pageUrl
	};
}

function parseEasychairHtml(html: string, pageUrl: string): CFPItem[] {
	const items: CFPItem[] = [];
	const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
	let rowMatch: RegExpExecArray | null;
	while ((rowMatch = rowRe.exec(html)) !== null) {
		const rowHtml = rowMatch[1];
		if (/<th[\s>]|Acronym\s*<\/|Name\s*<\/|Location\s*<\/|Submission\s*<\//i.test(rowHtml)) continue;
		const item = parseEasychairRow(rowHtml, pageUrl);
		if (item) items.push(item);
	}
	return items;
}

export async function fetchEasychair(urls: string[]): Promise<CFPItem[]> {
	const results: CFPItem[] = [];
	for (let i = 0; i < urls.length; i++) {
		const url = urls[i]?.trim();
		if (!url) continue;
		try {
			const resp = await requestUrl({ url, method: 'GET' });
			if (resp.status !== 200) continue;
			const items = parseEasychairHtml(resp.text, url);
			results.push(...items);
		} catch {
			// Skip failed URL
		}
		if (i < urls.length - 1) await delay(DELAY_MS);
	}
	return results;
}
