import { App, TFile } from 'obsidian';
import { MyPluginSettings } from '../types';
import { normalizePath } from '../utils/paths';
import { pureSeriesFromAcronym } from '../utils/series';
import {
	extractTakeawaySummary,
	PaperHubService,
	parseCoreNoteContent,
	resolvePaperPaths,
	TakeawayCandidate,
} from './paper-hub';

export interface VaultPaperEntry {
	file: TFile;
	citekey: string;
	title: string;
	authors: string[];
	year: string;
	venue: string;
	venueSeries: string;
	doi: string;
	url: string;
	codeUrl: string;
	projects: string[];
	linkedNotes: string[];
	tags: string[];
	coreNoteBody: string;
	tldr: string;
	contributions?: string;
	novelty: string;
	limitation: string;
	hasCoreNote: boolean;
	hasTakeaway: boolean;
	hasReport1: boolean;
	hasReport2: boolean;
}

export interface VaultVenuePaperRef {
	file: TFile;
	citekey: string;
	title: string;
	shortLabel: string;
	year: string;
	venueSeries: string;
}

export interface CandidateVaultMatch {
	candidate: TakeawayCandidate;
	matchedFile: TFile | null;
	matchType: 'exact' | 'overlap' | 'none';
	overlapScore: number;
}

export interface CitedVaultPaperMatch {
	file: TFile;
	citekey: string;
	title: string;
	year: string;
	matchedBy: 'citekey' | 'doi';
}

export interface ConnectorMatchResult {
	candidateMatches: CandidateVaultMatch[];
	citedPapers: CitedVaultPaperMatch[];
}

function fileBasename(file: TFile): string {
	if (file.basename) return file.basename;
	const rawName = file.name || file.path.split('/').pop() || '';
	return rawName.replace(/\.md$/i, '');
}

function toStringArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((v) => String(v ?? '').trim()).filter(Boolean);
	}
	if (typeof value === 'string' && value.trim()) {
		return [value.trim()];
	}
	return [];
}

function folderPrefixFromPattern(pattern: string): string {
	const normalized = normalizePath(pattern.trim());
	if (!normalized) return '';
	const placeholderIdx = normalized.search(/\{\{|\$\{/);
	const beforePlaceholder =
		placeholderIdx >= 0 ? normalized.slice(0, placeholderIdx) : normalized;
	const hasFileExt = /\.[^/]+$/.test(beforePlaceholder);
	if (!hasFileExt && placeholderIdx < 0) {
		return `${beforePlaceholder.replace(/\/+$/, '')}/`;
	}
	const slashIdx = beforePlaceholder.lastIndexOf('/');
	return slashIdx >= 0 ? beforePlaceholder.slice(0, slashIdx + 1) : '';
}

function tokenizeConcept(label: string): string[] {
	const parts = label
		.replace(/\.md$/i, '')
		.split(/\s+-\s+/)
		.map((s) => s.trim())
		.filter(Boolean);
	const relevant =
		parts[0]?.toUpperCase() === 'A' && parts.length >= 3 ? parts.slice(2) : parts;
	return Array.from(
		new Set(
			relevant
				.join(' ')
				.toLowerCase()
				.split(/[^a-z0-9]+/)
				.filter((tok) => tok.length >= 3)
		)
	);
}

export function normalizeVenueSeries(rawVenue: string): string {
	if (!rawVenue) return '';
	let text = rawVenue.trim().replace(/^["']+|["']+$/g, '');
	if (!text) return '';

	const wiki = text.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
	if (wiki) {
		text = (wiki[2] || wiki[1]).trim();
	} else {
		text = text.replace(/\[\[|\]\]/g, '').trim();
	}

	const parenMatch = text.match(
		/\((?:ACM\s+|IEEE\s+|USENIX\s+)?([A-Z][A-Za-z0-9/-]{1,14})(?:\s*['’]?\d{2,4})?\)/
	);
	if (parenMatch) {
		return pureSeriesFromAcronym(parenMatch[1]);
	}

	let cleaned = text
		.replace(/\bSeries\b/gi, '')
		.replace(/\b\d+(?:st|nd|rd|th)\b/gi, '')
		.replace(/\b(?:19|20)\d{2}\b/g, '')
		.replace(/['’]\d{2}\b/g, '')
		.replace(/\s+/g, ' ')
		.replace(/^[\s,.:;\-–—/]+|[\s,.:;\-–—/]+$/g, '')
		.trim();

	const orgPrefix = cleaned.match(/^(?:ACM|IEEE|USENIX)\s+([A-Z][A-Za-z0-9-]{1,14})$/);
	if (orgPrefix) {
		cleaned = orgPrefix[1];
	}

	if (!cleaned.includes(' ')) {
		return pureSeriesFromAcronym(cleaned);
	}
	return cleaned;
}

export function scoreLibraryMatch(entry: VaultPaperEntry, query: string): number {
	const tokens = query
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
	if (tokens.length === 0) return 1;

	const citekey = entry.citekey.toLowerCase();
	const title = entry.title.toLowerCase();
	const venue = `${entry.venue} ${entry.venueSeries}`.toLowerCase();
	const authors = entry.authors.join(' ').toLowerCase();
	const year = entry.year.toLowerCase();
	const meta = [...entry.projects, ...entry.tags].join(' ').toLowerCase();
	const notes = `${entry.coreNoteBody} ${entry.tldr} ${entry.contributions ?? ''} ${entry.novelty} ${entry.limitation}`.toLowerCase();

	let total = 0;
	for (const token of tokens) {
		let tokenScore = 0;
		if (citekey === token) tokenScore += 15;
		else if (citekey.includes(token)) tokenScore += 10;
		if (title.includes(token)) tokenScore += 8;
		if (venue.includes(token)) tokenScore += 6;
		if (authors.includes(token)) tokenScore += 4;
		if (year.includes(token)) tokenScore += 3;
		if (meta.includes(token)) tokenScore += 3;
		if (notes.includes(token)) tokenScore += 2;

		if (tokenScore === 0) return 0;
		total += tokenScore;
	}
	return total;
}

export class VaultLibraryService {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => MyPluginSettings,
		private readonly paperHub: PaperHubService
	) {}

	getLiteratureFolderPrefix(): string {
		const settings = this.getSettings();
		return folderPrefixFromPattern(
			settings.paperWorkspace.literatureNotePath || '002-Literature/{{citekey}}.md'
		);
	}

	private getExcludedFolderPrefixes(litPrefix: string): string[] {
		const s = this.getSettings();
		const ws = s.paperWorkspace;
		const candidates = [
			folderPrefixFromPattern(ws.report1Path),
			folderPrefixFromPattern(ws.report2Path),
			folderPrefixFromPattern(ws.takeawayPath),
			folderPrefixFromPattern(ws.coreNotePath),
			folderPrefixFromPattern(ws.highlightNotesFolder),
			folderPrefixFromPattern(s.fleetingNoteFolder),
			folderPrefixFromPattern(ws.atomicNotesFolder),
			folderPrefixFromPattern(s.cfpNoteDir),
			...(s.prompts || []).map((p) => folderPrefixFromPattern(p.vaultPath)),
		];
		return Array.from(new Set(candidates.filter((p) => Boolean(p) && p !== litPrefix)));
	}

	isPrimaryLiteratureFile(file: TFile): boolean {
		const path = normalizePath(file.path);
		if (!path.toLowerCase().endsWith('.md')) return false;

		const litPrefix = this.getLiteratureFolderPrefix();
		const excluded = this.getExcludedFolderPrefixes(litPrefix);
		if (excluded.some((prefix) => path.startsWith(prefix))) {
			return false;
		}

		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (fm?.['type'] === 'paper-note' || fm?.['cfp-series'] === true) {
			return false;
		}

		if (litPrefix && path.startsWith(litPrefix)) {
			return true;
		}
		return fm?.['type'] === 'literature';
	}

	async listLiteraturePapers(): Promise<VaultPaperEntry[]> {
		const settings = this.getSettings();
		const files = this.app.vault
			.getMarkdownFiles()
			.filter((file) => this.isPrimaryLiteratureFile(file));

		const entries = await Promise.all(
			files.map(async (file): Promise<VaultPaperEntry> => {
				const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
				const citekey = this.paperHub.getCitekeyForFile(file) || fileBasename(file);
				const paths = resolvePaperPaths(settings.paperWorkspace, citekey);

				const coreRawFile = this.app.vault.getAbstractFileByPath(paths.coreNote);
				const takeawayRawFile = this.app.vault.getAbstractFileByPath(paths.takeaway);
				const report1RawFile = this.app.vault.getAbstractFileByPath(paths.report1);
				const report2RawFile = this.app.vault.getAbstractFileByPath(paths.report2);

				const coreFile = coreRawFile instanceof TFile ? coreRawFile : null;
				const takeawayFile = takeawayRawFile instanceof TFile ? takeawayRawFile : null;
				const hasReport1 = report1RawFile instanceof TFile;
				const hasReport2 = report2RawFile instanceof TFile;

				const [coreContent, takeawayContent] = await Promise.all([
					coreFile ? this.app.vault.read(coreFile) : Promise.resolve(''),
					takeawayFile ? this.app.vault.read(takeawayFile) : Promise.resolve(''),
				]);

				const coreData = coreFile
					? parseCoreNoteContent(coreContent, citekey)
					: { citekey, source: '', projects: [], linkedNotes: [], body: '' };
				const summary = takeawayFile
					? extractTakeawaySummary(takeawayContent)
					: {
							tldr: '',
							topic: '',
							position: '',
							contributions: '',
							novelty: '',
							limitation: '',
						};

				const rawVenue = String(fm['venue'] ?? fm['publication'] ?? '').trim();
				const acronymHint = String(
					fm[settings.cfpAcronymKey || 'conference-acronym'] ?? ''
				).trim();
				const venueSeries = normalizeVenueSeries(acronymHint || rawVenue);
				const fmProjects = toStringArray(
					fm[settings.projectFrontmatterKey || 'projects']
				);

				return {
					file,
					citekey,
					title: String(fm['title'] ?? fileBasename(file)).trim(),
					authors: toStringArray(fm['authors']),
					year: String(fm['year'] ?? '').trim(),
					venue: rawVenue.replace(/^\[\[|\]\]$/g, ''),
					venueSeries,
					doi: String(fm['doi'] ?? '').trim(),
					url: String(fm['url'] ?? '').trim(),
					codeUrl: String(fm['code'] ?? '').trim(),
					projects: Array.from(new Set([...fmProjects, ...coreData.projects])),
					linkedNotes: coreData.linkedNotes,
					tags: toStringArray(fm['tags']),
					coreNoteBody: coreData.body,
					tldr: summary.tldr,
					contributions: summary.contributions,
					novelty: summary.novelty,
					limitation: summary.limitation,
					hasCoreNote: Boolean(coreFile),
					hasTakeaway: Boolean(takeawayFile),
					hasReport1,
					hasReport2,
				};
			})
		);

		return entries.sort((a, b) => {
			const yearDiff = (Number(b.year) || 0) - (Number(a.year) || 0);
			if (yearDiff !== 0) return yearDiff;
			const mtimeA = (a.file as { stat?: { mtime?: number } }).stat?.mtime ?? 0;
			const mtimeB = (b.file as { stat?: { mtime?: number } }).stat?.mtime ?? 0;
			if (mtimeB !== mtimeA) return mtimeB - mtimeA;
			return a.title.localeCompare(b.title);
		});
	}

	async searchPapers(
		query: string,
		filters?: { venue?: string; hasCoreNote?: boolean; hasTakeaway?: boolean }
	): Promise<VaultPaperEntry[]> {
		const all = await this.listLiteraturePapers();
		const targetVenue = filters?.venue ? normalizeVenueSeries(filters.venue).toLowerCase() : '';
		const rawVenueFilter = filters?.venue?.trim().toLowerCase() ?? '';

		const filtered = all.filter((entry) => {
			if (targetVenue) {
				const matchesSeries = entry.venueSeries.toLowerCase() === targetVenue;
				const matchesRaw = entry.venue.toLowerCase().includes(rawVenueFilter);
				if (!matchesSeries && !matchesRaw) return false;
			}
			if (filters?.hasCoreNote && !entry.hasCoreNote) return false;
			if (filters?.hasTakeaway && !entry.hasTakeaway) return false;
			return true;
		});

		const trimmedQuery = query.trim();
		if (!trimmedQuery) return filtered;

		return filtered
			.map((entry) => ({ entry, score: scoreLibraryMatch(entry, trimmedQuery) }))
			.filter((item) => item.score > 0)
			.sort((a, b) => b.score - a.score)
			.map((item) => item.entry);
	}

	findSameVenuePapers(currentFile: TFile, explicitSeries?: string): VaultVenuePaperRef[] {
		const settings = this.getSettings();
		const acronymKey = settings.cfpAcronymKey || 'conference-acronym';
		const currentFm = this.app.metadataCache.getFileCache(currentFile)?.frontmatter ?? {};
		const rawSeries =
			explicitSeries?.trim() ||
			String(currentFm[acronymKey] ?? currentFm['venue'] ?? currentFm['publication'] ?? '');
		const targetSeries = normalizeVenueSeries(rawSeries);
		if (!targetSeries) return [];

		const targetLower = targetSeries.toLowerCase();
		const refs: VaultVenuePaperRef[] = [];

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (file.path === currentFile.path || !this.isPrimaryLiteratureFile(file)) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
			const candSeries = normalizeVenueSeries(
				String(fm[acronymKey] ?? fm['venue'] ?? fm['publication'] ?? '')
			);
			if (!candSeries || candSeries.toLowerCase() !== targetLower) continue;

			const citekey = this.paperHub.getCitekeyForFile(file) || fileBasename(file);
			const year = String(fm['year'] ?? '').trim();
			const shortName = String(fm['short-name'] ?? '').trim();
			const firstAuthor = toStringArray(fm['authors'])[0] ?? '';
			const authorSurname = firstAuthor.split('-').pop() || firstAuthor;
			const baseLabel = shortName || authorSurname || citekey;
			const shortLabel = year && !baseLabel.includes(year) ? `${baseLabel} ${year}` : baseLabel;

			refs.push({
				file,
				citekey,
				title: String(fm['title'] ?? fileBasename(file)).trim(),
				shortLabel,
				year,
				venueSeries: candSeries,
			});
		}

		return refs.sort((a, b) => {
			const yearDiff = (Number(b.year) || 0) - (Number(a.year) || 0);
			return yearDiff !== 0 ? yearDiff : a.shortLabel.localeCompare(b.shortLabel);
		});
	}

	matchCandidatesAgainstVault(
		candidates: TakeawayCandidate[],
		reportTexts: string[],
		currentCitekey: string
	): ConnectorMatchResult {
		const settings = this.getSettings();
		const atomicFolder = normalizePath(
			settings.paperWorkspace.atomicNotesFolder || '003-Permanent'
		);
		const atomicPrefix = atomicFolder ? `${atomicFolder}/` : '';

		const allMdFiles = this.app.vault.getMarkdownFiles();
		const atomicFiles = allMdFiles.filter((f) => {
			const p = normalizePath(f.path);
			const base = fileBasename(f);
			return (atomicPrefix && p.startsWith(atomicPrefix)) || base.startsWith('A - ');
		});

		const candidateMatches: CandidateVaultMatch[] = candidates.map((candidate) => {
			if (candidate.linkPath?.trim()) {
				const rawLinkPath = candidate.linkPath.trim();
				const normalizedLinkPath = normalizePath(
					rawLinkPath.toLowerCase().endsWith('.md') ? rawLinkPath : `${rawLinkPath}.md`
				);
				const directFile = this.app.vault.getAbstractFileByPath(normalizedLinkPath);
				if (directFile instanceof TFile) {
					return {
						candidate,
						matchedFile: directFile,
						matchType: 'exact',
						overlapScore: 1,
					};
				}
			}

			const cleanTitle = (candidate.linkTitle.split('/').pop() || candidate.linkTitle)
				.replace(/\.md$/i, '')
				.trim();
			const exact =
				atomicFiles.find(
					(f) => fileBasename(f).toLowerCase() === cleanTitle.toLowerCase()
				) ??
				(candidate.linkStatus.toLowerCase().includes('existing')
					? allMdFiles.find(
							(f) =>
								!this.isPrimaryLiteratureFile(f) &&
								fileBasename(f).toLowerCase() === cleanTitle.toLowerCase()
						)
					: undefined);
			if (exact) {
				return {
					candidate,
					matchedFile: exact,
					matchType: 'exact',
					overlapScore: 1,
				};
			}

			const candTokens = tokenizeConcept(cleanTitle);
			let bestFile: TFile | null = null;
			let bestScore = 0;

			if (candTokens.length > 0) {
				for (const af of atomicFiles) {
					const fileTokens = tokenizeConcept(fileBasename(af));
					if (fileTokens.length === 0) continue;
					const fileTokenSet = new Set(fileTokens);
					const shared = candTokens.filter((t) => fileTokenSet.has(t)).length;
					if (shared === 0) continue;
					const denom = Math.min(candTokens.length, fileTokens.length);
					const ratio = shared / denom;
					if ((shared >= 2 || denom === 1) && ratio >= 0.5 && ratio > bestScore) {
						bestScore = ratio;
						bestFile = af;
					}
				}
			}

			return bestFile
				? {
						candidate,
						matchedFile: bestFile,
						matchType: 'overlap',
						overlapScore: Number(bestScore.toFixed(2)),
					}
				: {
						candidate,
						matchedFile: null,
						matchType: 'none',
						overlapScore: 0,
					};
		});

		const corpusLower = [
			...reportTexts,
			...candidates.map((c) => `${c.relatedPapers} ${c.evidence} ${c.brief}`),
		]
			.join('\n')
			.toLowerCase();

		const cleanCurrentKey = currentCitekey.replace(/^@/, '').trim().toLowerCase();
		const citedPapers: CitedVaultPaperMatch[] = [];

		if (corpusLower.trim().length > 0) {
			for (const file of allMdFiles) {
				if (!this.isPrimaryLiteratureFile(file)) continue;
				const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
				const citekey = (this.paperHub.getCitekeyForFile(file) || fileBasename(file))
					.replace(/^@/, '')
					.trim();
				if (!citekey || citekey.toLowerCase() === cleanCurrentKey) continue;

				const keyLower = citekey.toLowerCase();
				const escapedKey = keyLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const keyRegex = new RegExp(`(?:^|[^a-z0-9])${escapedKey}(?:$|[^a-z0-9])`, 'i');
				const doi = String(fm['doi'] ?? '')
					.trim()
					.replace(/^https?:\/\/doi\.org\//i, '')
					.toLowerCase();

				const keyMatched = keyLower.length >= 3 && keyRegex.test(corpusLower);
				const doiMatched = !keyMatched && doi.length >= 7 && corpusLower.includes(doi);

				if (keyMatched || doiMatched) {
					citedPapers.push({
						file,
						citekey,
						title: String(fm['title'] ?? fileBasename(file)).trim(),
						year: String(fm['year'] ?? '').trim(),
						matchedBy: keyMatched ? 'citekey' : 'doi',
					});
				}
			}
		}

		citedPapers.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
		return { candidateMatches, citedPapers };
	}

	async connectCandidateToVault(params: {
		literatureFile: TFile;
		citekey: string;
		candidate: TakeawayCandidate;
		mode: 'reuse' | 'create';
		targetFile?: TFile;
		appendEvidence?: boolean;
		rewriteTakeaway?: boolean;
	}): Promise<TFile> {
		const { literatureFile, citekey, candidate, mode, appendEvidence = true } = params;
		const litPathNoExt = literatureFile.path.replace(/\.md$/i, '');
		const sourceLink = `[[${litPathNoExt}|${citekey}]]`;

		const evidenceLines: string[] = [`### Evidence from ${sourceLink}`];
		if (candidate.storyline) evidenceLines.push(`- **Storyline**: ${candidate.storyline}`);
		if (candidate.brief) evidenceLines.push(`- **Brief**: ${candidate.brief}`);
		if (candidate.evidence) evidenceLines.push(`- **Evidence**: ${candidate.evidence}`);
		if (candidate.validation) evidenceLines.push(`- **Validation**: ${candidate.validation}`);
		if (candidate.tags.length > 0) {
			const tagLine = candidate.tags.map((t) => `#${t.replace(/^#/, '')}`).join(' ');
			evidenceLines.push(`- **Tags**: ${tagLine}`);
		}
		const evidenceBlock = evidenceLines.join('\n');

		let resolvedTarget: TFile;
		if (mode === 'reuse' && params.targetFile) {
			resolvedTarget = params.targetFile;
			if (appendEvidence) {
				const existing = await this.app.vault.read(resolvedTarget);
				if (!existing.includes(`Evidence from ${sourceLink}`)) {
					const updated = `${existing.trimEnd()}\n\n${evidenceBlock}\n`;
					await this.app.vault.modify(resolvedTarget, updated);
				}
			}

			const cleanCandTitle = (
				candidate.linkTitle.split('/').pop() || candidate.linkTitle
			)
				.replace(/\.md$/i, '')
				.trim();
			const chosenBasename = fileBasename(resolvedTarget);
			const shouldRewrite =
				params.rewriteTakeaway !== undefined
					? params.rewriteTakeaway
					: chosenBasename.toLowerCase() !== cleanCandTitle.toLowerCase();

			if (shouldRewrite) {
				const chosenPathNoExt = normalizePath(resolvedTarget.path).replace(
					/\.md$/i,
					''
				);
				const targetWikiLink = `[[${chosenPathNoExt}|${chosenBasename}]]`;
				await this.paperHub.rewriteCandidateLinkInTakeaway(
					citekey,
					candidate.index,
					targetWikiLink
				);
			}
		} else {
			const rawName = (candidate.linkTitle || `A - Concept - ${citekey}`)
				.replace(/\.md$/i, '')
				.replace(/[\\/:*?"<>|]/g, '-')
				.trim();
			const folder = normalizePath(
				this.getSettings().paperWorkspace.atomicNotesFolder || '003-Permanent'
			);
			const targetPath = normalizePath(folder ? `${folder}/${rawName}.md` : `${rawName}.md`);
			const existing = this.app.vault.getAbstractFileByPath(targetPath);

			if (existing instanceof TFile) {
				resolvedTarget = existing;
				if (appendEvidence) {
					const currentText = await this.app.vault.read(resolvedTarget);
					if (!currentText.includes(`Evidence from ${sourceLink}`)) {
						await this.app.vault.modify(
							resolvedTarget,
							`${currentText.trimEnd()}\n\n${evidenceBlock}\n`
						);
					}
				}
			} else {
				await this.paperHub.ensureParentFolder(targetPath);
				const tagList = candidate.tags.map((t) => `  - ${t.replace(/^#/, '')}`);
				const headerLines = [
					'---',
					'type: permanent',
					'sources:',
					`  - "${sourceLink}"`,
					...(tagList.length > 0 ? ['tags:', ...tagList] : []),
					'---',
					'',
					`# ${rawName}`,
					'',
					...(candidate.brief ? [candidate.brief, ''] : []),
					...(appendEvidence ? [evidenceBlock, ''] : []),
				];
				resolvedTarget = await this.app.vault.create(targetPath, headerLines.join('\n'));
			}
		}

		const state = await this.paperHub.getPaperState(literatureFile);
		const currentLinks = state?.coreNote.linkedNotes ?? [];
		const atomicWikiLink = `[[${fileBasename(resolvedTarget)}]]`;
		const nextLinks = currentLinks.includes(atomicWikiLink)
			? currentLinks
			: [...currentLinks, atomicWikiLink];

		await this.paperHub.saveCoreNote(citekey, { linkedNotes: nextLinks }, literatureFile);
		return resolvedTarget;
	}
}
