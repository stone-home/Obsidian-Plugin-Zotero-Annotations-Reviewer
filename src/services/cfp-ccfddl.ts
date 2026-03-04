import { requestUrl } from 'obsidian';
import yaml from 'js-yaml';
import { CFPItem, CFPRank } from '../types';

const DELAY_MS = 1500;

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export interface CcfRankInfo {
	ccf?: string;
	thcpl?: string;
	sub?: string;
}

let lastCcfRankMap: Record<string, CcfRankInfo> = {};

export function getCcfRankForSeriesTitle(title: string): CcfRankInfo | undefined {
	return lastCcfRankMap[title] || undefined;
}

/**
 * CCFDDL allconf.yml: single YAML file, not per-URL like WikiCFP.
 * Top-level array of: { title, description, sub, rank, dblp, confs: [ { year, id, link, timeline: [ { abstract_deadline?, deadline?, comment? } ], timezone, date, place } ] }
 */
interface CcfddlTimelineEntry {
	abstract_deadline?: string;
	deadline?: string;
	comment?: string;
}

interface CcfddlConf {
	year?: number;
	id?: string;
	link?: string;
	timeline?: CcfddlTimelineEntry[];
	timezone?: string;
	date?: string;
	place?: string;
}

interface CcfddlEntry {
	title?: string;
	description?: string;
	sub?: string;
	rank?: unknown;
	dblp?: string;
	confs?: CcfddlConf[];
}

/** Pick best submission deadline from timeline: prefer paper deadline, then abstract; skip TBD. */
function deadlineFromTimeline(timeline: CcfddlTimelineEntry[]): string {
	if (!Array.isArray(timeline) || timeline.length === 0) return 'N/A';
	const valid = (s: string | undefined) => s && s.trim() && s.toUpperCase() !== 'TBD';
	// Prefer last entry's deadline (often "final submission") then abstract_deadline
	for (let i = timeline.length - 1; i >= 0; i--) {
		const t = timeline[i];
		if (valid(t?.deadline)) return (t!.deadline ?? '').trim();
		if (valid(t?.abstract_deadline)) return (t!.abstract_deadline ?? '').trim();
	}
	for (const t of timeline) {
		if (valid(t?.deadline)) return (t!.deadline ?? '').trim();
		if (valid(t?.abstract_deadline)) return (t!.abstract_deadline ?? '').trim();
	}
	return 'N/A';
}

export function parseCcfddlYaml(text: string): CFPItem[] {
	const items: CFPItem[] = [];
	let data: CcfddlEntry[];
	try {
		data = yaml.load(text) as CcfddlEntry[];
	} catch {
		return items;
	}
	if (!Array.isArray(data)) return items;

	// Rebuild rank map on each parse so helpers can be used elsewhere.
	lastCcfRankMap = {};

	for (const entry of data) {
		const title = (entry.title ?? '').toString().trim();
		const fullName = (entry.description ?? title).toString().trim();
		if (!title) continue;

		// Capture series-level CCF rank metadata.
		const rankObj = (entry.rank ?? {}) as CFPRank['sources'] & { ccf?: unknown; thcpl?: unknown };
		const ccf = (rankObj as any)?.ccf?.toString()?.trim();
		const thcpl = (rankObj as any)?.thcpl?.toString()?.trim();
		const sub = entry.sub?.toString()?.trim();
		if (ccf || thcpl || sub) {
			lastCcfRankMap[title] = {
				ccf: ccf || undefined,
				thcpl: thcpl || undefined,
				sub: sub || undefined
			};
		}

		const confs = entry.confs ?? [];
		for (const conf of confs) {
			const year = conf.year;
			const eventAcronym = year != null ? `${title} ${year}` : title;
			const submissionDdl = deadlineFromTimeline(conf.timeline ?? []);
			items.push({
				acronym: eventAcronym,
				series: title,
				fullName: fullName || eventAcronym,
				location: (conf.place ?? '').toString().trim() || 'N/A',
				start: conf.date?.toString(),
				end: undefined,
				submissionDdl,
				source: 'ccfddl',
				url: conf.link?.toString()
			});
		}
	}
	return items;
}

export async function fetchCcfddl(urls: string[]): Promise<CFPItem[]> {
	const results: CFPItem[] = [];
	for (let i = 0; i < urls.length; i++) {
		const url = urls[i]?.trim();
		if (!url) continue;
		try {
			const resp = await requestUrl({ url, method: 'GET' });
			if (resp.status !== 200) continue;
			const list = parseCcfddlYaml(resp.text);
			results.push(...list);
		} catch {
			// Skip failed URL
		}
		if (i < urls.length - 1) await delay(DELAY_MS);
	}
	return results;
}
