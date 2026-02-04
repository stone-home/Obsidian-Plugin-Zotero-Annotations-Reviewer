import { App, normalizePath, Notice, TFile } from 'obsidian';
import { CFPItem, MyPluginSettings, CFPItemWithPath, CFPConferenceMatch } from '../types';
import { fetchWikiCFP } from './cfp-wikicfp';
import { fetchCcfddl } from './cfp-ccfddl';
import {
	fetchWikiCFPSeriesIndex,
	fetchSeriesEvents,
	delay,
	randomDelayMs
} from './cfp-wikicfp-series';
import { fetchEasychair } from './cfp-easychair';
import { fetchOpenresearch } from './cfp-openresearch';
import { pureSeriesFromAcronym } from '../utils/series';

function sanitizeFileName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|]/g, '')
		.trim()
		.slice(0, 100) || 'cfp';
}

/** Normalize various date formats into YYYY-MM-DD for Dataview. */
function normalizeDateString(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const str = String(raw).trim();
	if (!str) return undefined;

	// Strip ordinal suffixes: 18th -> 18
	const cleaned = str.replace(/(\d+)(st|nd|rd|th)/gi, '$1');

	const d = new Date(cleaned);
	if (isNaN(d.getTime())) return str; // fall back to original if unparseable

	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

function frontmatterFromItem(item: CFPItem, defaultTags: string[]): string {
	const start = normalizeDateString(item.start);
	const end = normalizeDateString(item.end);
	const ddl = normalizeDateString(item.submissionDdl);

	const lines: string[] = [
		'acronym: ' + JSON.stringify(item.acronym),
		'full-name: ' + JSON.stringify(item.fullName),
		'location: ' + JSON.stringify(item.location),
		// Use underscore so Dataview can access it without quoting.
		'submission_ddl: ' + JSON.stringify(ddl ?? ''),
		'cfp-source: ' + JSON.stringify(item.source)
	];
	if (item.series) lines.push('series: "[[' + item.series + ' Series]]"');
	if (start) lines.push('start: ' + JSON.stringify(start));
	if (end) lines.push('end: ' + JSON.stringify(end));
	if (item.url) lines.push('url: ' + JSON.stringify(item.url));
	if (defaultTags.length) lines.push('tags: ' + JSON.stringify(defaultTags));
	return lines.join('\n');
}

/** Create folder if it does not exist. Ignores "Folder already exists" from Obsidian. */
async function ensureFolder(app: App, path: string): Promise<void> {
	const normalized = normalizePath(path);
	if (app.vault.getAbstractFileByPath(normalized)) return;
	try {
		await app.vault.createFolder(normalized);
	} catch (e) {
		const msg = (e as Error)?.message ?? '';
		if (!msg.includes('already exists') && !msg.includes('Folder already exists')) throw e;
	}
}

/**
 * Returns the DataviewJS script body for the "Refresh events" button.
 * Uses settings.cfpSeriesDataviewJSCode if available, otherwise default.
 * Exported for agent/test verification.
 */
export function getSeriesRefreshButtonDataviewJS(settings?: MyPluginSettings): string {
	if (settings?.cfpSeriesDataviewJSCode) {
		return settings.cfpSeriesDataviewJSCode;
	}
	// Fallback default
	return [
		'const cur = dv.current();',
		'if (cur && cur["series-url"]) {',
		'  const programUrl = cur["series-url"];',
		'  const seriesAcronym = (cur.file?.name || "").replace(/\\s+Series(\\.md)?$/i, "");',
		'  const btn = dv.el("button", "Refresh events");',
		'  btn.addEventListener("click", (e) => {',
		'    e.preventDefault();',
		'    if (window.__ZoteroAnnotationReviewerCFP)',
		'      window.__ZoteroAnnotationReviewerCFP.refreshSeries(programUrl, seriesAcronym);',
		'  });',
		'}'
	].join('\n');
}

/** Write content to path; create or overwrite. Handles "File already exists" by modifying existing file. */
async function createOrOverwriteFile(app: App, path: string, content: string): Promise<void> {
	const normalized = normalizePath(path);
	const existing = app.vault.getAbstractFileByPath(normalized);
	if (existing && existing instanceof TFile) {
		await app.vault.modify(existing, content);
		return;
	}
	try {
		await app.vault.create(normalized, content);
	} catch (e) {
		const msg = (e as Error)?.message ?? '';
		if (msg.includes('File already exists') || msg.includes('already exists')) {
			const file = app.vault.getAbstractFileByPath(normalized);
			if (file && file instanceof TFile) await app.vault.modify(file, content);
			return;
		}
		throw e;
	}
}

export class CFPService {
	constructor(
		private app: App,
		private getSettings: () => MyPluginSettings,
		private saveSettings: () => Promise<void>
	) {}

	getLastFetchTime(): number {
		return this.getSettings().cfpLastFetchTime ?? 0;
	}

	async setLastFetchTime(t: number): Promise<void> {
		this.getSettings().cfpLastFetchTime = t;
		await this.saveSettings();
	}

	shouldRefresh(): boolean {
		const s = this.getSettings();
		const days = s.cfpRefreshDays ?? 5;
		if (days <= 0) return false;
		const last = this.getLastFetchTime();
		if (last <= 0) return true;
		const elapsedDays = (Date.now() - last) / (24 * 60 * 60 * 1000);
		return elapsedDays >= days;
	}

	getLastSeriesFetchTime(): number {
		return this.getSettings().cfpLastSeriesFetchTime ?? 0;
	}

	async setLastSeriesFetchTime(t: number): Promise<void> {
		this.getSettings().cfpLastSeriesFetchTime = t;
		await this.saveSettings();
	}

	/** Whether WikiCFP Conference Series (A–Z) scan is due (independent from URL-source refresh). */
	shouldSeriesRefresh(): boolean {
		const s = this.getSettings();
		const days = s.cfpSeriesRefreshDays ?? 30;
		if (days <= 0) return false;
		const last = this.getLastSeriesFetchTime();
		if (last <= 0) return true;
		const elapsedDays = (Date.now() - last) / (24 * 60 * 60 * 1000);
		return elapsedDays >= days;
	}

	getSeriesMap(): Record<string, { programUrl: string; lastUpdate: number }> {
		const m = this.getSettings().cfpSeriesMap;
		return typeof m === 'object' && m !== null ? { ...m } : {};
	}

	async saveSeriesMap(map: Record<string, { programUrl: string; lastUpdate: number }>): Promise<void> {
		this.getSettings().cfpSeriesMap = map;
		await this.saveSettings();
	}

	async updateSeriesLastUpdate(seriesKey: string): Promise<void> {
		const map = this.getSeriesMap();
		const entry = map[seriesKey];
		if (!entry) return;
		map[seriesKey] = { ...entry, lastUpdate: Date.now() };
		await this.saveSeriesMap(map);
	}

	async fetchAll(): Promise<CFPItem[]> {
		const s = this.getSettings();
		// Priority: WikiCFP > CCFDDL > EasyChair > OpenResearch (first occurrence wins)
		const wikicfp = s.cfpWikicfpUrls?.length ? await fetchWikiCFP(s.cfpWikicfpUrls) : [];
		const ccfddl = s.cfpCcfddlUrls?.length ? await fetchCcfddl(s.cfpCcfddlUrls) : [];
		const easychair = s.cfpEasychairUrls?.length ? await fetchEasychair(s.cfpEasychairUrls) : [];
		const openresearch = s.cfpOpenresearchUrls?.length ? await fetchOpenresearch(s.cfpOpenresearchUrls) : [];
		const combined = [...wikicfp, ...ccfddl, ...easychair, ...openresearch];
		const seen = new Set<string>();
		return combined.filter(item => {
			const key = item.acronym.toLowerCase();
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	async syncToNotes(items: CFPItem[]): Promise<number> {
		const s = this.getSettings();
		const dir = (s.cfpNoteDir || 'CFP').trim() || 'CFP';
		const defaultTags = Array.isArray(s.cfpDefaultTags) ? s.cfpDefaultTags : ['cfp'];
		const basePath = normalizePath(dir);

		await ensureFolder(this.app, basePath);

		let created = 0;
		let skipped = 0;
		for (const item of items) {
			if (!item.acronym) {
				console.warn('[CFP] skipping item without acronym:', item);
				continue;
			}
			const notePath = this.itemToPath(basePath, item);
			const existing = this.app.vault.getAbstractFileByPath(notePath);
			if (existing) {
				console.log('[CFP] skipping existing file:', notePath, 'item:', item.acronym);
				skipped++;
				continue;
			}
			const dirPath = item.series
				? normalizePath(basePath + '/' + sanitizeFileName(item.series))
				: basePath;
			await ensureFolder(this.app, dirPath);
			if (item.series) {
				await this.ensureSeriesNote(dirPath, item.series, defaultTags);
			}
			const fileName = sanitizeFileName(item.acronym) + '.md';
			const path = normalizePath(dirPath + '/' + fileName);
			const yaml = frontmatterFromItem(item, defaultTags);
			const content = '---\n' + yaml + '\n---\n\n';
			console.log('[CFP] creating file:', path, 'acronym:', item.acronym, 'series:', item.series);
			try {
				await createOrOverwriteFile(this.app, path, content);
				created++;
			} catch (e) {
				console.error('[CFP] failed to create file:', path, e);
			}
		}
		console.log('[CFP] syncToNotes result:', { total: items.length, created, skipped });
		return created;
	}

	private itemToPath(basePath: string, item: CFPItem): string {
		const dirPath = item.series
			? normalizePath(basePath + '/' + sanitizeFileName(item.series))
			: basePath;
		return normalizePath(dirPath + '/' + sanitizeFileName(item.acronym) + '.md');
	}

	private async ensureSeriesNote(
		dirPath: string,
		seriesName: string,
		defaultTags: string[],
		programUrl?: string,
		seriesFullName?: string
	): Promise<void> {
		const seriesFileName = sanitizeFileName(seriesName) + ' Series.md';
		const seriesPath = normalizePath(dirPath + '/' + seriesFileName);
		const title = seriesName + ' Series';
		let seriesUrl = programUrl ?? '';
		const existing = this.app.vault.getAbstractFileByPath(seriesPath);
		if (existing && existing instanceof TFile && !programUrl) {
			const cache = this.app.metadataCache.getFileCache(existing);
			const existingUrl = cache?.frontmatter?.['series-url']?.toString?.();
			if (existingUrl) seriesUrl = existingUrl;
		}
		const fmLines = [
			'title: ' + JSON.stringify(title),
			'tags: ' + JSON.stringify(defaultTags),
			'cfp-series: true'
		];
		if (seriesUrl) fmLines.push('series-url: ' + JSON.stringify(seriesUrl));
		// Store full name (e.g. "OSDI: Operating Systems Design and Implementation" → "Operating Systems Design and Implementation")
		if (seriesFullName?.trim()) {
			const displayName = seriesFullName.includes(':')
				? seriesFullName.split(':').slice(1).join(':').trim()
				: seriesFullName.trim();
			if (displayName) fmLines.push('series-full-name: ' + JSON.stringify(displayName));
		}
		const fm = fmLines.join('\n');
		const tableQuery = [
			'TABLE file.link as "Event", acronym as "Acronym", "full-name" as "Full Name", location as "Location", submission_ddl as "Deadline", start as "Start", end as "End", cfp-source as "Source", url as "URL"',
			'FROM [[' + seriesName + ' Series]]',
			'SORT file.name DESC'
		].join('\n');
		const refreshButtonBlock = seriesUrl
			? '\n```dataviewjs\n' + getSeriesRefreshButtonDataviewJS(this.getSettings()) + '\n```\n\n'
			: '';
		const body = refreshButtonBlock + '```dataview\n' + tableQuery + '\n```\n';
		await createOrOverwriteFile(this.app, seriesPath, '---\n' + fm + '\n---\n' + body);
	}

	async refresh(): Promise<void> {
		new Notice('Refreshing CFP from all sources...');
		try {
			const items = await this.fetchAll();
			const synced = await this.syncToNotes(items);
			await this.setLastFetchTime(Date.now());
			new Notice(`CFP refresh done. ${synced} items synced.`);
		} catch (e) {
			console.error('[CFP] refresh failed', e);
			new Notice('CFP refresh failed. See console.');
		}
	}

	async refreshWikiCFPUrls(): Promise<void> {
		new Notice('Refreshing WikiCFP URLs...');
		try {
			const s = this.getSettings();
			const items = s.cfpWikicfpUrls?.length ? await fetchWikiCFP(s.cfpWikicfpUrls) : [];
			const synced = await this.syncToNotes(items);
			new Notice(`WikiCFP URLs refreshed. ${synced} items synced.`);
		} catch (e) {
			console.error('[CFP] WikiCFP URLs refresh failed', e);
			new Notice('WikiCFP URLs refresh failed. See console.');
		}
	}

	async refreshCcfddlUrls(): Promise<void> {
		new Notice('Refreshing CCFDDL URLs...');
		try {
			const s = this.getSettings();
			const items = s.cfpCcfddlUrls?.length ? await fetchCcfddl(s.cfpCcfddlUrls) : [];
			const synced = await this.syncToNotes(items);
			new Notice(`CCFDDL URLs refreshed. ${synced} items synced.`);
		} catch (e) {
			console.error('[CFP] CCFDDL URLs refresh failed', e);
			new Notice('CCFDDL URLs refresh failed. See console.');
		}
	}

	async refreshEasychairUrls(): Promise<void> {
		new Notice('Refreshing EasyChair URLs...');
		try {
			const s = this.getSettings();
			const items = s.cfpEasychairUrls?.length ? await fetchEasychair(s.cfpEasychairUrls) : [];
			const synced = await this.syncToNotes(items);
			new Notice(`EasyChair URLs refreshed. ${synced} items synced.`);
		} catch (e) {
			console.error('[CFP] EasyChair URLs refresh failed', e);
			new Notice('EasyChair URLs refresh failed. See console.');
		}
	}

	async refreshOpenresearchUrls(): Promise<void> {
		new Notice('Refreshing OpenResearch URLs...');
		try {
			const s = this.getSettings();
			const items = s.cfpOpenresearchUrls?.length ? await fetchOpenresearch(s.cfpOpenresearchUrls) : [];
			const synced = await this.syncToNotes(items);
			new Notice(`OpenResearch URLs refreshed. ${synced} items synced.`);
		} catch (e) {
			console.error('[CFP] OpenResearch URLs refresh failed', e);
			new Notice('OpenResearch URLs refresh failed. See console.');
		}
	}

	/**
	 * Refresh from WikiCFP Conf Series (A–Z index): create series folders and Series notes with series-url,
	 * update seriesMap (programUrl, lastUpdate). Does NOT fetch events here; use manual button or daily job.
	 */
	async refreshWikiCFPSeries(onProgress?: (msg: string) => void): Promise<void> {
		const s = this.getSettings();
		const letters = Array.isArray(s.cfpSeriesIndexLetters) && s.cfpSeriesIndexLetters.length > 0
			? s.cfpSeriesIndexLetters
			: undefined;
		const lettersDesc = letters ? ` (${letters.join(', ')})` : ' (A–Z)';
		onProgress?.(`Fetching WikiCFP series index${lettersDesc} (5–10s between pages)...`);
		const entries = await fetchWikiCFPSeriesIndex(
			(letter, count) => onProgress?.(`Index ${letter}: ${count} series`),
			letters
		);
		const basePath = normalizePath((s.cfpNoteDir || 'CFP').trim() || 'CFP');
		const defaultTags = Array.isArray(s.cfpDefaultTags) ? s.cfpDefaultTags : ['cfp'];
		await ensureFolder(this.app, basePath);
		const map = this.getSeriesMap();
		for (const entry of entries) {
			const dirPath = normalizePath(basePath + '/' + sanitizeFileName(entry.seriesAcronym));
			await ensureFolder(this.app, dirPath);
			await this.ensureSeriesNote(dirPath, entry.seriesAcronym, defaultTags, entry.programUrl, entry.fullName);
			const key = entry.seriesAcronym;
			if (!map[key] || map[key].programUrl !== entry.programUrl) {
				map[key] = { programUrl: entry.programUrl, lastUpdate: map[key]?.lastUpdate ?? 0 };
			}
		}
		await this.saveSeriesMap(map);
		await this.setLastSeriesFetchTime(Date.now());
		onProgress?.('WikiCFP series index done. Use "Refresh events" on a Series note or wait for daily refresh.');
	}

	/** Fetch events for one series by program URL and sync to notes. Updates series lastUpdate. */
	async refreshSeriesByUrl(programUrl: string, seriesAcronym: string, onProgress?: (msg: string) => void): Promise<void> {
		onProgress?.('Fetching events...');
		const events = await fetchSeriesEvents(programUrl, seriesAcronym, onProgress);
		onProgress?.(`Found ${events.length} events, syncing to notes...`);
		console.log('[CFP] refreshSeriesByUrl:', { programUrl, seriesAcronym, eventCount: events.length });
		console.log('[CFP] events:', events.map(e => ({ acronym: e.acronym, series: e.series, url: e.url })));
		const synced = await this.syncToNotes(events);
		console.log('[CFP] synced count:', synced);
		const map = this.getSeriesMap();
		map[seriesAcronym] = { programUrl, lastUpdate: Date.now() };
		await this.saveSeriesMap(map);
		onProgress?.(`Synced ${synced} events.`);
	}

	/** Daily job: pick 10–20 series with oldest lastUpdate, refresh each with ≥30 min gap. */
	async runDailySeriesRefresh(): Promise<void> {
		const s = this.getSettings();
		const ONE_DAY = 24 * 60 * 60 * 1000;
		if (s.cfpLastDailyRun > 0 && Date.now() - s.cfpLastDailyRun < ONE_DAY) return;
		s.cfpLastDailyRun = Date.now();
		await this.saveSettings();

		const map = this.getSeriesMap();
		const keys = Object.keys(map).filter(k => map[k].programUrl);
		if (keys.length === 0) return;

		const sorted = keys
			.map(k => ({ key: k, lastUpdate: map[k].lastUpdate }))
			.sort((a, b) => a.lastUpdate - b.lastUpdate);
		const toRefresh = sorted.slice(0, Math.min(20, Math.max(10, sorted.length)));
		const MIN_GAP_MS = 30 * 60 * 1000;

		for (let i = 0; i < toRefresh.length; i++) {
			const { key } = toRefresh[i];
			const programUrl = map[key].programUrl;
			setTimeout(() => {
				this.refreshSeriesByUrl(programUrl, key, msg => console.log('[CFP]', key, msg))
					.then(() => new Notice(`CFP: ${key} refreshed.`))
					.catch(e => console.warn('[CFP] daily refresh failed', key, e));
			}, i * MIN_GAP_MS);
		}
	}

	/** Create or overwrite a single CFP note (manual entry). If item has series, place under series folder and link to Series note. */
	async saveManualCFP(item: CFPItem): Promise<void> {
		const s = this.getSettings();
		const basePath = normalizePath((s.cfpNoteDir || 'CFP').trim() || 'CFP');
		const defaultTags = Array.isArray(s.cfpDefaultTags) ? s.cfpDefaultTags : ['cfp'];
		await ensureFolder(this.app, basePath);
		const dirPath = item.series
			? normalizePath(basePath + '/' + sanitizeFileName(item.series))
			: basePath;
		await ensureFolder(this.app, dirPath);
		if (item.series) await this.ensureSeriesNote(dirPath, item.series, defaultTags);

		const fileName = sanitizeFileName(item.acronym) + '.md';
		const path = normalizePath(dirPath + '/' + fileName);
		const yaml = frontmatterFromItem(item, defaultTags);
		const content = '---\n' + yaml + '\n---\n\n';
		await createOrOverwriteFile(this.app, path, content);
	}

	/**
	 * Find the best matching CFP event for a given conference metadata snapshot
	 * (from a Zotero literature note), and derive series context.
	 *
	 * Uses a heuristic scoring function over all CFP notes under the CFP folder.
	 */
	async findBestMatchingCFPForConference(meta: {
		conferenceName?: string;
		proceedingsTitle?: string;
		place?: string;
		year?: number;
		/** When set, try exact match by this acronym first (e.g. from note frontmatter). */
		acronymFromNote?: string;
	}): Promise<CFPConferenceMatch> {
		const settings = this.getSettings();
		const dir = (settings.cfpNoteDir || 'CFP').trim() || 'CFP';
		const dirPath = normalizePath(dir);
		const prefix = dirPath + '/';

		const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(prefix));
		if (files.length === 0) {
			console.log('[CFP] findBestMatchingCFPForConference: no CFP notes found under', dirPath);
			return { event: null };
		}

		// Extract lightweight CFP items + paths from frontmatter (similar to getCFPNotesForDisplay).
		const events: CFPItemWithPath[] = [];
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter;
			// Skip series notes themselves.
			if (!fm || fm['cfp-series']) continue;
			const submissionDdl = (fm['submission-ddl'] ?? fm['submission_ddl'] ?? '').toString();
			const item: CFPItem = {
				acronym: (fm['acronym'] ?? '').toString(),
				series: fm['series']?.toString()?.replace(/^\[\[|\]\]$/g, '').replace(/\s+Series$/, '') || undefined,
				fullName: (fm['full-name'] ?? fm['title'] ?? '').toString(),
				location: (fm['location'] ?? '').toString(),
				start: fm['start']?.toString(),
				end: fm['end']?.toString(),
				submissionDdl,
				source: (fm['cfp-source'] ?? 'manual') as CFPItem['source'],
				url: fm['url']?.toString()
			};
			if (!item.acronym) continue;
			events.push({ item, path: file.path });
		}

		if (events.length === 0) {
			console.log('[CFP] findBestMatchingCFPForConference: no event notes found under', dirPath, '(check CFP folder path in settings)');
			return { event: null };
		}

		const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

		// Workaround: if note has an acronym in a dedicated property, do exact match first (e.g. OSDI from "Proceedings of the 16th USENIX Symposium on OSDI").
		const noteAcronym = meta.acronymFromNote?.trim();
		if (noteAcronym) {
			const noteNorm = norm(noteAcronym);
			if (noteNorm) {
				const exactMatches = events.filter(e => {
					const a = norm(e.item.acronym);
					const series = e.item.series ? norm(e.item.series) : '';
					return a === noteNorm || a.startsWith(noteNorm + ' ') || series === noteNorm;
				});

				// Helper: return Series-only match when we can locate the Series note for this acronym.
				const trySeriesOnlyFallback = (): CFPConferenceMatch | null => {
					const seriesCandidates = [noteAcronym, pureSeriesFromAcronym(noteAcronym)];
					for (const candidate of seriesCandidates) {
						const seriesName = candidate.trim();
						if (!seriesName) continue;
						const seriesFolder = normalizePath(dirPath + '/' + sanitizeFileName(seriesName));
						const seriesNotePath = normalizePath(seriesFolder + '/' + sanitizeFileName(seriesName) + ' Series.md');
						const file = this.app.vault.getAbstractFileByPath(seriesNotePath);
						if (file && file instanceof TFile) {
							let latestTs = 0;
							let latestStr: string | undefined;
							for (const e of events) {
								if (!e.item.series && pureSeriesFromAcronym(e.item.acronym) !== seriesName) continue;
								if (e.item.series && e.item.series !== seriesName) continue;
								const ddl = e.item.submissionDdl;
								if (!ddl) continue;
								const d = new Date(ddl);
								const ts = d.getTime();
								if (!isNaN(ts) && ts > latestTs) {
									latestTs = ts;
									latestStr = ddl;
								}
							}
							console.log('[CFP] findBestMatchingCFPForConference: series-only fallback by acronymFromNote', {
								seriesName,
								seriesNotePath,
								latestSeriesDdl: latestStr
							});
							return { event: null, seriesNotePath, latestSeriesDdl: latestStr };
						}
					}
					return null;
				};

				if (exactMatches.length === 0) {
					console.log('[CFP] findBestMatchingCFPForConference: acronymFromNote had no exact match', {
						acronymFromNote: noteAcronym,
						noteNorm,
						cfpDir: dirPath,
						eventCount: events.length,
						sampleAcronyms: events.slice(0, 8).map(e => e.item.acronym)
					});
					const fallback = trySeriesOnlyFallback();
					if (fallback) return fallback;
				} else {
					// We have acronym/series matches. Only show a specific event when note has a year and an event matches that year.
					if (!meta.year) {
						// No year: do not pick an arbitrary event; show Series only.
						const fallback = trySeriesOnlyFallback();
						if (fallback) return fallback;
						return { event: null };
					}
					const yearStr = String(meta.year);
					const yearMatches = exactMatches.filter(e =>
						e.item.acronym.includes(yearStr) || (e.item.start != null && e.item.start.includes(yearStr))
					);
					if (yearMatches.length === 0) {
						// No event for this year → series-only.
						const fallback = trySeriesOnlyFallback();
						if (fallback) return fallback;
						return { event: null };
					}
					const best = yearMatches[0];
					console.log('[CFP] findBestMatchingCFPForConference: exact match by acronymFromNote', { acronymFromNote: noteAcronym, year: meta.year, chosen: best.item.acronym });
					const result: CFPConferenceMatch = { event: best };
					const seriesName = best.item.series || pureSeriesFromAcronym(best.item.acronym);
					if (seriesName) {
						const seriesFolder = normalizePath(dirPath + '/' + sanitizeFileName(seriesName));
						result.seriesNotePath = normalizePath(seriesFolder + '/' + sanitizeFileName(seriesName) + ' Series.md');
						let latestTs = 0;
						let latestStr: string | undefined;
						for (const e of events) {
							if (!e.item.series && pureSeriesFromAcronym(e.item.acronym) !== seriesName) continue;
							if (e.item.series && e.item.series !== seriesName) continue;
							const ddl = e.item.submissionDdl;
							if (!ddl) continue;
							const d = new Date(ddl);
							const ts = d.getTime();
							if (!isNaN(ts) && ts > latestTs) {
								latestTs = ts;
								latestStr = ddl;
							}
						}
						if (latestStr) result.latestSeriesDdl = latestStr;
					}
					return result;
				}
			}
		}

		// --- Build matching key from meta ---
		const rawName = (meta.conferenceName || meta.proceedingsTitle || '').toString();
		const place = meta.place?.toString() || '';
		let year = meta.year;
		if (!year) {
			const yearMatch = rawName.match(/\b(20\d{2}|19\d{2})\b/);
			if (yearMatch) {
				year = parseInt(yearMatch[1], 10);
			}
		}

		let seriesToken = '';
		if (rawName) {
			// Take leading capital letters (and optional slashes) as series token, e.g. "SCA/HPCAsia 2026"
			const m = rawName.match(/^[A-Z][A-Z0-9/+-]*/);
			if (m) {
				seriesToken = m[0].replace(/\d+$/, '').trim();
			}
		}
		const seriesTokenNorm = norm(seriesToken);
		const placeNorm = norm(place);
		const nameNorm = norm(rawName);

		// Skip generic words when counting title overlap so "Proceedings... Conference... International" don't match any CFP.
		const STOPWORDS = new Set([
			'proceedings', 'the', 'and', 'on', 'in', 'of', 'to', 'for', 'conference', 'international',
			'annual', 'workshop', 'symposium', 'region', 'pacific', 'europe', 'asia', 'high', 'performance',
			'computing', 'abstract', 'interpretation', 'verification', 'model', 'checking'
		]);
		const meaningfulNameTokens = nameNorm
			? new Set(
					nameNorm.split(/\s+/).filter(t => t.length > 1 && !STOPWORDS.has(t))
				)
			: new Set<string>();

		const scoreEvent = (e: CFPItemWithPath): number => {
			let score = 0;
			const item = e.item;
			const itemSeries = item.series || pureSeriesFromAcronym(item.acronym);
			const itemSeriesNorm = norm(itemSeries);
			const acronymNorm = norm(item.acronym);
			const fullNameNorm = norm(item.fullName);
			const locationNorm = norm(item.location);

			// Series/acronym alignment: only when we have a real acronym (≥2 chars). Avoid "P" from "Proceedings" matching anything.
			if (seriesTokenNorm.length >= 2 && (itemSeriesNorm.includes(seriesTokenNorm) || acronymNorm.startsWith(seriesTokenNorm))) {
				score += 60;
			}

			// Year alignment (in acronym, start date, or title).
			if (year) {
				const yearStr = String(year);
				if (item.acronym.includes(yearStr) || (item.start && item.start.includes(yearStr))) {
					score += 40;
				}
			}

			// Title/name similarity: only meaningful token overlap (exclude generic words).
			if (meaningfulNameTokens.size > 0) {
				const targetTokens = (acronymNorm + ' ' + fullNameNorm).split(/\s+/).filter(Boolean);
				let overlap = 0;
				for (const t of targetTokens) {
					if (t.length > 1 && !STOPWORDS.has(t) && meaningfulNameTokens.has(t)) overlap++;
				}
				if (overlap > 0) score += Math.min(overlap * 5, 25);
			}

			// Location similarity.
			if (placeNorm && placeNorm.length >= 3 && locationNorm.includes(placeNorm)) {
				score += 15;
			}

			return score;
		};

		let best: CFPItemWithPath | null = null;
		let bestScore = 0;
		for (const e of events) {
			const s = scoreEvent(e);
			if (s > bestScore) {
				bestScore = s;
				best = e;
			}
		}

		// When note has a year, require the chosen event to have the same year (acronym or start).
		if (best && year) {
			const yearStr = String(year);
			const eventHasYear = best.item.acronym.includes(yearStr) || (best.item.start != null && best.item.start.includes(yearStr));
			if (!eventHasYear) {
				best = null;
				bestScore = 0;
			}
		}

		// Only show when similarity is clearly high (e.g. acronym + year). Avoid "display worse than no display".
		const MIN_SCORE = 100;
		if (!best || bestScore < MIN_SCORE) {
			console.log('[CFP] findBestMatchingCFPForConference: no strong match found', {
				rawName,
				place,
				year,
				bestScore
			});
			return { event: null };
		}

		console.log('[CFP] findBestMatchingCFPForConference: match found', {
			rawName,
			place,
			year,
			bestScore,
			acronym: best.item.acronym,
			series: best.item.series
		});

		// Derive series information and latest submission deadline among that series.
		const result: CFPConferenceMatch = { event: best };
		const seriesName = best.item.series || pureSeriesFromAcronym(best.item.acronym);
		if (seriesName) {
			// Series note path matches ensureSeriesNote.
			const seriesFolder = normalizePath(dirPath + '/' + sanitizeFileName(seriesName));
			result.seriesNotePath = normalizePath(seriesFolder + '/' + sanitizeFileName(seriesName) + ' Series.md');

			// Find latest submission_ddl among events of this series.
			let latestTs = 0;
			let latestStr: string | undefined;
			for (const e of events) {
				if (!e.item.series && pureSeriesFromAcronym(e.item.acronym) !== seriesName) continue;
				if (e.item.series && e.item.series !== seriesName) continue;
				const ddl = e.item.submissionDdl;
				if (!ddl) continue;
				const d = new Date(ddl);
				const ts = d.getTime();
				if (!isNaN(ts) && ts > latestTs) {
					latestTs = ts;
					latestStr = ddl;
				}
			}
			if (latestStr) {
				result.latestSeriesDdl = latestStr;
			}
		}

		return result;
	}

	/** Update DataviewJS code in all existing Series notes. */
	async updateAllSeriesNotesDataviewJS(): Promise<number> {
		const s = this.getSettings();
		const dir = (s.cfpNoteDir || 'CFP').trim() || 'CFP';
		const dirPath = normalizePath(dir);
		const prefix = dirPath + '/';
		const code = getSeriesRefreshButtonDataviewJS(s);
		
		const files = this.app.vault.getMarkdownFiles().filter(f => {
			if (!f.path.startsWith(prefix)) return false;
			const cache = this.app.metadataCache.getFileCache(f);
			return cache?.frontmatter?.['cfp-series'] === true;
		});
		
		let updated = 0;
		for (const file of files) {
			try {
				const content = await this.app.vault.read(file);
				const cache = this.app.metadataCache.getFileCache(file);
				const seriesUrl = cache?.frontmatter?.['series-url']?.toString?.();
				
				// Only update if series-url exists (has refresh button)
				if (!seriesUrl) continue;
				
				// Find dataviewjs code block and replace it
				const codeBlockRe = /```dataviewjs\n([\s\S]*?)\n```/;
				const match = content.match(codeBlockRe);
				if (match) {
					const newContent = content.replace(codeBlockRe, '```dataviewjs\n' + code + '\n```');
					if (newContent !== content) {
						await this.app.vault.modify(file, newContent);
						updated++;
					}
				} else {
					// No dataviewjs block found, try to insert before dataview table block
					const tableBlockRe = /(```dataview\n[\s\S]*?```)/;
					if (tableBlockRe.test(content)) {
						const newContent = content.replace(tableBlockRe, '```dataviewjs\n' + code + '\n```\n\n$1');
						await this.app.vault.modify(file, newContent);
						updated++;
					}
				}
			} catch (e) {
				console.warn('[CFP] failed to update Series note:', file.path, e);
			}
		}
		return updated;
	}

	/** Read all CFP notes from the folder; return upcoming and past, each with item + path for opening. */
	async getCFPNotesForDisplay(): Promise<{ upcoming: { item: CFPItem; path: string }[]; past: { item: CFPItem; path: string }[] }> {
		const s = this.getSettings();
		const dir = (s.cfpNoteDir || 'CFP').trim() || 'CFP';
		const dirPath = normalizePath(dir);
		const prefix = dirPath + '/';
		const rel = (p: string) => p.slice(prefix.length);
		const files = this.app.vault.getMarkdownFiles().filter(f => {
			if (!f.path.startsWith(prefix)) return false;
			const r = rel(f.path);
			return (r.match(/\//g) || []).length <= 1; // root or one subdir (series folder)
		});
		const now = Date.now();
		const parseDate = (str: string): number => {
			if (!str) return 0;
			const d = new Date(str);
			return isNaN(d.getTime()) ? 0 : d.getTime();
		};
		const withPathAndTs: { item: CFPItem; path: string; ts: number }[] = [];
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			const fm = cache?.frontmatter;
			if (!fm || fm['cfp-series']) continue;
			const submissionDdl = (fm['submission-ddl'] ?? fm['submission_ddl'] ?? '').toString();
			const item: CFPItem = {
				acronym: (fm['acronym'] ?? '').toString(),
				series: fm['series']?.toString()?.replace(/^\[\[|\]\]$/g, '').replace(/\s+Series$/, '') || undefined,
				fullName: (fm['full-name'] ?? fm['title'] ?? '').toString(),
				location: (fm['location'] ?? '').toString(),
				start: fm['start']?.toString(),
				end: fm['end']?.toString(),
				submissionDdl,
				source: (fm['cfp-source'] ?? 'manual') as CFPItem['source'],
				url: fm['url']?.toString()
			};
			withPathAndTs.push({ item, path: file.path, ts: parseDate(submissionDdl) });
		}
		const upcoming = withPathAndTs.filter(x => x.ts >= now).sort((a, b) => a.ts - b.ts).map(({ item, path }) => ({ item, path }));
		const past = withPathAndTs.filter(x => x.ts > 0 && x.ts < now).sort((a, b) => b.ts - a.ts).map(({ item, path }) => ({ item, path }));
		return { upcoming, past };
	}
}
