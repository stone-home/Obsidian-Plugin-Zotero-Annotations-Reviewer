import { App, TFile } from 'obsidian';
import yaml from 'js-yaml';
import {
	DEFAULT_ATOMIC_NOTE_TEMPLATE,
	DEFAULT_CORE_NOTE_TEMPLATE,
	DEFAULT_PAPER_WORKSPACE,
	DEFAULT_REPORT1_NOTE_TEMPLATE,
	DEFAULT_REPORT1_PROMPT,
	DEFAULT_REPORT2_NOTE_TEMPLATE,
	DEFAULT_REPORT2_PROMPT,
	DEFAULT_SYNTHESIZE_PROMPT,
	DEFAULT_TAKEAWAY_NOTE_TEMPLATE,
	DEFAULT_ZOTERO_TEMPLATE,
	MyPluginSettings,
	PaperWorkspaceConfig,
	PromptTemplateEntry,
} from '../types';
import { normalizePath } from '../utils/paths';

export interface ResolvedPaperPaths {
	citekey: string;
	literatureNote: string;
	report1: string;
	report2: string;
	takeaway: string;
	coreNote: string;
}

export interface TakeawaySummary {
	tldr: string;
	topic: string;
	position: string;
	contributions: string;
	novelty: string;
	limitation: string;
}

export interface TakeawayCandidate {
	index: number;
	heading: string;
	typeLabel?: string;
	linkTitle: string;
	linkPath?: string;
	source?: string;
	linkStatus: string;
	storyline: string;
	answers?: string;
	validation?: string;
	evidence: string;
	brief: string;
	relatedPapers: string;
	tags: string[];
}

export interface CoreNoteData {
	citekey: string;
	source: string;
	projects: string[];
	linkedNotes: string[];
	body: string;
	extraFrontmatter?: Record<string, unknown>;
}

export interface NoteTemplateVars {
	citekey: string;
	title?: string;
	sourcePath?: string;
	date?: string;
	atomicTitle?: string;
}

export interface FleetingNoteSummary {
	file: TFile;
	thought: string;
	read: boolean;
}

export interface PaperState {
	citekey: string;
	literatureFile: TFile;
	paths: ResolvedPaperPaths;
	takeawayFile: TFile | null;
	report1File: TFile | null;
	report2File: TFile | null;
	coreNoteFile: TFile | null;
	coreNote: CoreNoteData;
	takeawaySummary: TakeawaySummary;
	takeawayCandidates: TakeawayCandidate[];
	takeawayRaw: string;
	report2Raw: string;
	projects: string[];
	codeUrl: string | null;
	doiUrl: string | null;
	deepReportUrl: string | null;
	externalReportUrl: string | null;
	fleetingNotes: FleetingNoteSummary[];
}

const INVALID_URL_TOKENS = new Set([
	'null',
	'none',
	'n/a',
	'na',
	'unknown',
	'tbd',
	'-',
]);

function normalizeHttpUrl(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!trimmed || INVALID_URL_TOKENS.has(trimmed.toLowerCase())) return null;
	return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null;
}

function toStringList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.map((item) => String(item ?? '').trim()).filter(Boolean);
	}
	if (typeof value === 'string' && value.trim()) {
		return [value.trim()];
	}
	return [];
}

function extractThoughtSnippet(markdown: string): string {
	const thoughtSection = markdown.match(
		/(?:^|\r?\n)##\s+Thoughts\s*\r?\n([\s\S]*?)(?=\r?\n##\s+|$)/i
	);
	if (thoughtSection) {
		const cleaned = thoughtSection[1]
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !/^Comment at\s+/i.test(line))
			.join(' ');
		if (cleaned) return cleaned;
	}
	const highlightSection = markdown.match(
		/```ad-quote\s*\r?\n(?:title:[^\r\n]*\r?\n)?([\s\S]*?)```/i
	);
	if (highlightSection) {
		return highlightSection[1].trim().replace(/\s+/g, ' ').slice(0, 180);
	}
	return '';
}

export function resolveCitekeyTemplate(pattern: string, citekey: string): string {
	const cleanKey = citekey.trim();
	const replaced = pattern.replace(
		/\{\{\s*(?:citekey|citation-key)\s*\}\}|\$\{\s*citekey\s*\}/gi,
		cleanKey
	);
	const normalized = normalizePath(replaced);
	if (
		pattern.trim().toLowerCase().endsWith('.md') &&
		!normalized.toLowerCase().endsWith('.md')
	) {
		return `${normalized}.md`;
	}
	return normalized;
}

export function resolvePaperPaths(
	workspace: PaperWorkspaceConfig,
	citekey: string
): ResolvedPaperPaths {
	const cleanKey = citekey.trim();
	const literatureNote = resolveCitekeyTemplate(
		workspace.literatureNotePath,
		cleanKey
	);
	const report1 = resolveCitekeyTemplate(workspace.report1Path, cleanKey);
	const report2 = resolveCitekeyTemplate(workspace.report2Path, cleanKey);
	const takeaway = resolveCitekeyTemplate(workspace.takeawayPath, cleanKey);
	const coreNote = resolveCitekeyTemplate(workspace.coreNotePath, cleanKey);

	return {
		citekey: cleanKey,
		literatureNote,
		report1,
		report2,
		takeaway,
		coreNote,
	};
}

export function extractCodeUrlFromReport(markdown: string): string | null {
	if (!markdown) return null;

	const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
	let fenceMatch: RegExpExecArray | null;
	while ((fenceMatch = fenceRegex.exec(markdown)) !== null) {
		try {
			const parsed = JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>;
			const fromJson = normalizeHttpUrl(parsed?.code_url);
			if (fromJson) return fromJson;
		} catch {
			// Fall back to inline match below
		}
	}

	const inlineMatch = markdown.match(/"code_url"\s*:\s*"([^"]*)"/i);
	if (inlineMatch) {
		return normalizeHttpUrl(inlineMatch[1]);
	}
	return null;
}

export function unwrapTakeawayMarkdown(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.startsWith('{')) {
		try {
			const parsed = JSON.parse(trimmed) as Record<string, unknown>;
			if (parsed && typeof parsed.markdown_body === 'string') {
				return parsed.markdown_body;
			}
		} catch {
			return raw;
		}
	}
	return raw;
}

function matchInlineField(markdown: string, fieldPattern: string): string {
	const re = new RegExp(
		`(?:^|\\n)\\s*(?:[-*]\\s*)?[^\\n]*?(?:\\*\\*)?(?:${fieldPattern})(?:\\*\\*)?\\s*::\\s*(.+)`,
		'i'
	);
	const m = markdown.match(re);
	return m ? m[1].trim() : '';
}

export function extractTakeawaySummary(raw: string): TakeawaySummary {
	const md = unwrapTakeawayMarkdown(raw);
	return {
		tldr: matchInlineField(md, 'TL;DR'),
		topic: matchInlineField(md, 'topic'),
		position: matchInlineField(md, 'position'),
		contributions: matchInlineField(md, 'contributions'),
		novelty: matchInlineField(md, 'novelty'),
		limitation: matchInlineField(md, 'limitation'),
	};
}

function extractBulletValue(block: string, label: string): string {
	const re = new RegExp(
		`^[ \\t]*[-*][ \\t]*(?:\\*\\*)?${label}(?:\\*\\*)?[ \\t]*[:：][ \\t]*(.+)$`,
		'im'
	);
	const match = block.match(re);
	return match ? match[1].trim() : '';
}

function parseWikiLinkParts(text: string): { target: string; alias: string } | null {
	const match = text.match(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/);
	if (!match) return null;
	return {
		target: match[1].trim(),
		alias: (match[2] ?? '').trim(),
	};
}

export function parseTakeawayCandidates(raw: string): TakeawayCandidate[] {
	const md = unwrapTakeawayMarkdown(raw);
	const headingRegex = /^###\s+Candidate\s+(\d+)\s*[:\-–—]?\s*(.*)$/gim;
	const matches: Array<{
		index: number;
		heading: string;
		start: number;
		bodyStart: number;
	}> = [];

	let match: RegExpExecArray | null;
	while ((match = headingRegex.exec(md)) !== null) {
		matches.push({
			index: Number(match[1]),
			heading: match[2].trim(),
			start: match.index,
			bodyStart: headingRegex.lastIndex,
		});
	}

	return matches.map((item, idx) => {
		const nextStart = idx + 1 < matches.length ? matches[idx + 1].start : md.length;
		const rawSlice = md.slice(item.bodyStart, nextStart);
		const nextSectionIdx = rawSlice.search(/\r?\n##\s+/);
		const block =
			nextSectionIdx >= 0 ? rawSlice.slice(0, nextSectionIdx) : rawSlice;

		const headingWithoutWiki = item.heading.replace(/\[\[[^\]]*\]\]/g, '');
		const typeMatch = headingWithoutWiki.match(/\[([^[\]]+)\]/);
		const typeLabel = typeMatch ? typeMatch[1].trim() : '';

		let linkTitle = '';
		let linkPath = '';

		const rawLinkBullet = extractBulletValue(block, 'Link');
		if (rawLinkBullet) {
			const bulletWiki = parseWikiLinkParts(rawLinkBullet);
			if (bulletWiki) {
				linkTitle = (
					bulletWiki.alias ||
					bulletWiki.target.split('/').pop() ||
					bulletWiki.target
				).trim();
				linkPath = bulletWiki.target.includes('/')
					? bulletWiki.target.trim()
					: '';
			} else {
				const plainBulletLink = rawLinkBullet.replace(/\[\[|\]\]/g, '').trim();
				if (plainBulletLink) {
					linkTitle = plainBulletLink;
					linkPath = plainBulletLink.includes('/') ? plainBulletLink : '';
				}
			}
		}

		if (!linkTitle) {
			const headingWiki = parseWikiLinkParts(item.heading);
			if (headingWiki) {
				linkTitle = (
					headingWiki.target.split('/').pop() ||
					headingWiki.alias ||
					headingWiki.target
				).trim();
				linkPath = headingWiki.target.includes('/')
					? headingWiki.target.trim()
					: '';
			}
		}

		if (!linkTitle) {
			const strippedHeading = item.heading
				.replace(/\[([^[\]]+)\]/g, '')
				.replace(/\[\[|\]\]/g, '')
				.replace(/^[\s:\-–—]+|[\s:\-–—]+$/g, '')
				.trim();
			linkTitle = strippedHeading || `A - Concept - Candidate ${item.index}`;
		}

		const rawTags =
			extractBulletValue(block, 'Potential Tags') ||
			extractBulletValue(block, 'Tags');
		const tags = rawTags
			? rawTags
					.split(/[,;]+|\s+(?=#)/)
					.map((t) => t.trim().replace(/^#/, ''))
					.filter(
						(t) =>
							Boolean(t) &&
							t !== '-' &&
							!['none', 'n/a'].includes(t.toLowerCase())
					)
			: [];

		return {
			index: item.index,
			heading: item.heading,
			typeLabel,
			linkTitle,
			linkPath,
			source: extractBulletValue(block, 'Source'),
			linkStatus: extractBulletValue(block, 'Link Status'),
			storyline: extractBulletValue(block, 'Storyline'),
			answers: extractBulletValue(block, 'Answers'),
			validation: extractBulletValue(block, 'Validation'),
			evidence: extractBulletValue(block, 'Evidence'),
			brief: extractBulletValue(block, 'Brief'),
			relatedPapers: extractBulletValue(block, 'Related Papers'),
			tags,
		};
	});
}

function formatTodayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

export function renderNoteTemplateString(
	template: string,
	vars: NoteTemplateVars
): string {
	const cleanCitekey = vars.citekey.trim();
	const rawTitle = (
		vars.title !== undefined && vars.title.trim() ? vars.title : cleanCitekey
	).trim();
	const escapedTitle = rawTitle
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\r?\n/g, ' ');
	const cleanSourcePath = (
		vars.sourcePath !== undefined && vars.sourcePath.trim()
			? vars.sourcePath
			: cleanCitekey
	)
		.trim()
		.replace(/\.md$/i, '');
	const cleanDate = vars.date?.trim() || formatTodayIso();
	const cleanAtomicTitle = (vars.atomicTitle ?? '').trim();

	return template
		.replace(/\{\{\s*citekey\s*\}\}/g, () => cleanCitekey)
		.replace(/\{\{\s*title\s*\}\}/g, () => escapedTitle)
		.replace(/\{\{\s*source_path\s*\}\}/g, () => cleanSourcePath)
		.replace(/\{\{\s*date\s*\}\}/g, () => cleanDate)
		.replace(/\{\{\s*atomic_title\s*\}\}/g, () => cleanAtomicTitle);
}

function normalizeYamlScalar(val: unknown): unknown {
	if (val instanceof Date && !isNaN(val.getTime())) {
		return val.toISOString().slice(0, 10);
	}
	if (Array.isArray(val)) {
		return val.map(normalizeYamlScalar);
	}
	if (val && typeof val === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
			out[k] = normalizeYamlScalar(v);
		}
		return out;
	}
	return val;
}

export function parseCoreNoteContent(raw: string, fallbackCitekey = ''): CoreNoteData {
	const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!fmMatch) {
		const cleanFallback = fallbackCitekey.trim();
		return {
			citekey: cleanFallback,
			source: cleanFallback ? `[[${cleanFallback}]]` : '',
			projects: [],
			linkedNotes: [],
			body: raw.trim(),
		};
	}

	let fm: Record<string, unknown> = {};
	try {
		const loaded = yaml.load(fmMatch[1]);
		if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
			fm = loaded as Record<string, unknown>;
		}
	} catch {
		fm = {};
	}

	const citekey = String(
		fm['citation-key'] ?? fm['citekey'] ?? fallbackCitekey
	).trim();
	const source = String(fm['source'] ?? (citekey ? `[[${citekey}]]` : '')).trim();
	const projects = toStringList(fm['projects']);
	const linkedNotes = toStringList(fm['linked-notes'] ?? fm['linkedNotes']);

	const extra: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fm)) {
		if (
			key === 'citation-key' ||
			key === 'citekey' ||
			key === 'source' ||
			key === 'projects' ||
			key === 'linked-notes' ||
			key === 'linkedNotes' ||
			(key === 'type' && value === 'paper-note')
		) {
			continue;
		}
		extra[key] = normalizeYamlScalar(value);
	}

	return {
		citekey,
		source,
		projects,
		linkedNotes,
		body: fmMatch[2].trim(),
		...(Object.keys(extra).length > 0 ? { extraFrontmatter: extra } : {}),
	};
}

export function serializeCoreNoteContent(data: CoreNoteData): string {
	const extra = data.extraFrontmatter ?? {};
	const fmObj: Record<string, unknown> = {
		'citation-key': data.citekey,
		type:
			typeof extra['type'] === 'string' && extra['type'].trim()
				? extra['type'].trim()
				: 'paper-note',
		source: data.source || (data.citekey ? `[[${data.citekey}]]` : ''),
	};
	for (const [key, value] of Object.entries(extra)) {
		if (
			key === 'citation-key' ||
			key === 'citekey' ||
			key === 'type' ||
			key === 'source' ||
			key === 'projects' ||
			key === 'linked-notes' ||
			key === 'linkedNotes' ||
			key === 'tags'
		) {
			continue;
		}
		fmObj[key] = value;
	}
	fmObj['projects'] = data.projects;
	fmObj['linked-notes'] = data.linkedNotes;
	if ('tags' in extra && extra['tags'] !== undefined) {
		fmObj['tags'] = extra['tags'];
	}
	const yamlBlock = yaml.dump(fmObj, { lineWidth: -1 }).trimEnd();
	const body = data.body.trim();
	return body ? `---\n${yamlBlock}\n---\n\n${body}\n` : `---\n${yamlBlock}\n---\n`;
}

export class PaperHubService {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => MyPluginSettings
	) {}

	getCitekeyForFile(file: TFile): string | null {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) return null;
		const keyName = this.getSettings().citationKeyName || 'citation-key';
		const raw = fm[keyName] ?? fm['citation-key'] ?? fm['zotero-key'];
		if (raw === undefined || raw === null) return null;
		const trimmed = String(raw).trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		const normalized = normalizePath(folderPath).replace(/\/+$/, '');
		if (!normalized) return;
		const segments = normalized.split('/').filter(Boolean);
		let current = '';
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				try {
					await this.app.vault.createFolder(current);
				} catch (e) {
					const msg = (e as Error)?.message ?? '';
					if (!msg.toLowerCase().includes('already exists')) throw e;
				}
			}
		}
	}

	async ensureParentFolder(filePath: string): Promise<void> {
		const normalized = normalizePath(filePath);
		const parentFolder = normalized
			.split('/')
			.slice(0, -1)
			.filter(Boolean)
			.join('/');
		await this.ensureFolderExists(parentFolder);
	}

	private getVaultFile(path: string): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
		return f instanceof TFile ? f : null;
	}

	private async writeVaultFile(filePath: string, content: string): Promise<TFile> {
		const normalized = normalizePath(filePath);
		await this.ensureParentFolder(normalized);
		const existing = this.getVaultFile(normalized);
		if (existing) {
			await this.app.vault.modify(existing, content);
			return existing;
		}
		return await this.app.vault.create(normalized, content);
	}

	async getPaperState(file: TFile): Promise<PaperState | null> {
		const citekey = this.getCitekeyForFile(file);
		if (!citekey) return null;

		const settings = this.getSettings();
		const paths = resolvePaperPaths(settings.paperWorkspace, citekey);
		const takeawayFile = this.getVaultFile(paths.takeaway);
		const report1File = this.getVaultFile(paths.report1);
		const report2File = this.getVaultFile(paths.report2);
		const coreNoteFile = this.getVaultFile(paths.coreNote);

		const cleanCitekey = citekey.replace(/^@/, '').toLowerCase();
		const highlightFolder = normalizePath(
			settings.paperWorkspace.highlightNotesFolder ||
				settings.fleetingNoteFolder ||
				''
		);
		const highlightPrefix = highlightFolder ? `${highlightFolder}/` : '';

		const fleetingFiles = this.app.vault.getMarkdownFiles().filter((candidate) => {
			if (candidate.path === file.path) return false;
			if (highlightPrefix && !candidate.path.startsWith(highlightPrefix))
				return false;
			const candKey = this.getCitekeyForFile(candidate);
			return Boolean(
				candKey && candKey.replace(/^@/, '').toLowerCase() === cleanCitekey
			);
		});

		const [coreNoteRaw, takeawayRaw, report2Raw, fleetingContents] =
			await Promise.all([
				coreNoteFile ? this.app.vault.read(coreNoteFile) : Promise.resolve(''),
				takeawayFile ? this.app.vault.read(takeawayFile) : Promise.resolve(''),
				report2File ? this.app.vault.read(report2File) : Promise.resolve(''),
				Promise.all(fleetingFiles.map((fl) => this.app.vault.read(fl))),
			]);

		const litPathNoExt = file.path.replace(/\.md$/i, '');
		const coreNote: CoreNoteData = coreNoteFile
			? parseCoreNoteContent(coreNoteRaw, citekey)
			: {
					citekey,
					source: `[[${litPathNoExt}|${citekey}]]`,
					projects: [],
					linkedNotes: [],
					body: '',
				};

		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const litProjects = toStringList(
			fm[settings.projectFrontmatterKey || 'projects']
		);
		const projects = Array.from(new Set([...litProjects, ...coreNote.projects]));

		const fmCodeUrl = normalizeHttpUrl(fm['code']);
		const report2CodeUrl = report2Raw ? extractCodeUrlFromReport(report2Raw) : null;
		const codeUrl = fmCodeUrl ?? report2CodeUrl;

		if (
			!fmCodeUrl &&
			report2CodeUrl &&
			(!fm['code'] || !String(fm['code']).trim()) &&
			(
				this.app as unknown as {
					fileManager?: {
						processFrontMatter?: (
							f: TFile,
							cb: (frontmatter: Record<string, unknown>) => void
						) => Promise<void>;
					};
				}
			).fileManager?.processFrontMatter
		) {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				if (!frontmatter['code'] || !String(frontmatter['code']).trim()) {
					frontmatter['code'] = report2CodeUrl;
				}
			});
		}

		const deepReportUrl = normalizeHttpUrl(fm['deep-report']);
		const externalReportUrl = normalizeHttpUrl(fm['external-report']);

		const rawDoi = String(fm['doi'] ?? '').trim();
		const doiUrl = rawDoi
			? /^https?:\/\//i.test(rawDoi)
				? rawDoi
				: `https://doi.org/${rawDoi.replace(/^doi:\s*/i, '')}`
			: normalizeHttpUrl(fm['url']);

		const fleetingNotes: FleetingNoteSummary[] = fleetingFiles.map((fl, idx) => {
			const flFm = this.app.metadataCache.getFileCache(fl)?.frontmatter ?? {};
			const flTags = toStringList(flFm['tags']);
			const isRead = Boolean(
				flFm['read'] === true ||
				flFm['status'] === 'read' ||
				flTags.includes('status/read')
			);
			return {
				file: fl,
				thought: extractThoughtSnippet(fleetingContents[idx]),
				read: isRead,
			};
		});

		return {
			citekey,
			literatureFile: file,
			paths,
			takeawayFile,
			report1File,
			report2File,
			coreNoteFile,
			coreNote,
			takeawaySummary: takeawayRaw
				? extractTakeawaySummary(takeawayRaw)
				: {
						tldr: '',
						topic: '',
						position: '',
						contributions: '',
						novelty: '',
						limitation: '',
					},
			takeawayCandidates: takeawayRaw ? parseTakeawayCandidates(takeawayRaw) : [],
			takeawayRaw,
			report2Raw,
			projects,
			codeUrl,
			doiUrl,
			deepReportUrl,
			externalReportUrl,
			fleetingNotes,
		};
	}

	async createOrOpenReportFile(
		citekey: string,
		kind: 'takeaway' | 'report1' | 'report2' | 'coreNote',
		literatureFile?: TFile
	): Promise<TFile> {
		const cleanKey = citekey.trim();
		const paths = resolvePaperPaths(this.getSettings().paperWorkspace, cleanKey);
		const targetPath = normalizePath(paths[kind]);
		const existing = this.getVaultFile(targetPath);
		if (existing) return existing;

		const tplMap: Record<
			'takeaway' | 'report1' | 'report2' | 'coreNote',
			{ id: string; fallback: string }
		> = {
			report1: { id: 'tpl-report1', fallback: DEFAULT_REPORT1_NOTE_TEMPLATE },
			report2: { id: 'tpl-report2', fallback: DEFAULT_REPORT2_NOTE_TEMPLATE },
			takeaway: { id: 'tpl-takeaway', fallback: DEFAULT_TAKEAWAY_NOTE_TEMPLATE },
			coreNote: { id: 'tpl-core-note', fallback: DEFAULT_CORE_NOTE_TEMPLATE },
		};

		const { id: tplId, fallback } = tplMap[kind];
		const rawTemplate = (await this.getPromptContent(tplId)) || fallback;

		const resolvedLitFile =
			literatureFile ?? this.getVaultFile(paths.literatureNote);
		const fm = resolvedLitFile
			? this.app.metadataCache.getFileCache(resolvedLitFile)?.frontmatter
			: undefined;
		const rawTitle =
			fm?.['title'] !== undefined && fm?.['title'] !== null
				? String(fm['title']).trim()
				: '';
		const sourcePath = (literatureFile?.path ?? paths.literatureNote).replace(
			/\.md$/i,
			''
		);

		const initialContent = renderNoteTemplateString(rawTemplate, {
			citekey: cleanKey,
			title: rawTitle || cleanKey,
			sourcePath,
		});

		await this.ensureParentFolder(targetPath);
		return await this.app.vault.create(targetPath, initialContent);
	}

	async rewriteCandidateLinkInTakeaway(
		citekey: string,
		candidateIndex: number,
		newWikiLink: string
	): Promise<boolean> {
		const paths = resolvePaperPaths(this.getSettings().paperWorkspace, citekey);
		const takeawayFile = this.getVaultFile(paths.takeaway);
		if (!takeawayFile) return false;

		const raw = await this.app.vault.read(takeawayFile);
		let isJsonEnvelope = false;
		let parsedJson: Record<string, unknown> | null = null;
		let md = raw;

		const trimmed = raw.trim();
		if (trimmed.startsWith('{')) {
			try {
				const parsed = JSON.parse(trimmed) as Record<string, unknown>;
				if (parsed && typeof parsed.markdown_body === 'string') {
					isJsonEnvelope = true;
					parsedJson = parsed;
					md = parsed.markdown_body;
				}
			} catch {
				// Treat as raw markdown
			}
		}

		const headingRe = new RegExp(
			`^###\\s+Candidate\\s+${candidateIndex}\\b[^\\r\\n]*`,
			'im'
		);
		const headingMatch = headingRe.exec(md);
		if (!headingMatch) return false;

		const sectionBodyStart = headingMatch.index + headingMatch[0].length;
		const afterHeading = md.slice(sectionBodyStart);
		const nextBoundary = afterHeading.match(
			/\r?\n(?:###\s+Candidate\s+\d+\b|##\s+)/i
		);
		const sectionBodyEnd =
			nextBoundary && nextBoundary.index !== undefined
				? sectionBodyStart + nextBoundary.index
				: md.length;

		let sectionBody = md.slice(sectionBodyStart, sectionBodyEnd);
		const linkLineRe =
			/^[ \t]*[-*][ \t]*(?:\*\*)?Link(?:\*\*)?[ \t]*[:：][ \t]*.+$/im;
		if (linkLineRe.test(sectionBody)) {
			sectionBody = sectionBody.replace(linkLineRe, `- **Link**: ${newWikiLink}`);
		} else {
			sectionBody = `\n- **Link**: ${newWikiLink}${sectionBody}`;
		}

		const statusLineRe =
			/^[ \t]*[-*][ \t]*(?:\*\*)?Link Status(?:\*\*)?[ \t]*[:：][ \t]*.+$/im;
		if (statusLineRe.test(sectionBody)) {
			sectionBody = sectionBody.replace(
				statusLineRe,
				'- **Link Status**: Existing — Linked in Vault'
			);
		}

		const updatedMd =
			md.slice(0, sectionBodyStart) + sectionBody + md.slice(sectionBodyEnd);
		const finalContent =
			isJsonEnvelope && parsedJson
				? JSON.stringify({ ...parsedJson, markdown_body: updatedMd }, null, 2)
				: updatedMd;

		await this.app.vault.modify(takeawayFile, finalContent);
		return true;
	}

	async saveReportMarkdown(
		citekey: string,
		kind: 'report1' | 'report2' | 'takeaway',
		rawContent: string,
		literatureFile?: TFile
	): Promise<{ file: TFile; extractedCodeUrl: string | null }> {
		const settings = this.getSettings();
		const paths = resolvePaperPaths(settings.paperWorkspace, citekey);
		const targetPath = paths[kind];
		const markdown =
			kind === 'takeaway' ? unwrapTakeawayMarkdown(rawContent) : rawContent;
		const savedFile = await this.writeVaultFile(targetPath, markdown);

		const extractedCodeUrl =
			kind === 'report2' ? extractCodeUrlFromReport(markdown) : null;
		if (
			extractedCodeUrl &&
			literatureFile &&
			this.app.fileManager?.processFrontMatter
		) {
			await this.app.fileManager.processFrontMatter(
				literatureFile,
				(frontmatter) => {
					if (!frontmatter['code'] || !String(frontmatter['code']).trim()) {
						frontmatter['code'] = extractedCodeUrl;
					}
				}
			);
		}

		return { file: savedFile, extractedCodeUrl };
	}

	async saveCoreNote(
		citekey: string,
		patch: Partial<Omit<CoreNoteData, 'citekey'>>,
		literatureFile?: TFile
	): Promise<TFile> {
		const settings = this.getSettings();
		const paths = resolvePaperPaths(settings.paperWorkspace, citekey);
		const existingFile = this.getVaultFile(paths.coreNote);

		const defaultSource = literatureFile
			? `[[${literatureFile.path.replace(/\.md$/i, '')}|${citekey}]]`
			: `[[${citekey}]]`;

		const current: CoreNoteData = existingFile
			? parseCoreNoteContent(await this.app.vault.read(existingFile), citekey)
			: {
					citekey,
					source: defaultSource,
					projects: [],
					linkedNotes: [],
					body: '',
				};

		const nextExtra =
			patch.extraFrontmatter !== undefined
				? patch.extraFrontmatter
				: current.extraFrontmatter;

		const merged: CoreNoteData = {
			citekey,
			source:
				patch.source !== undefined
					? patch.source
					: current.source || defaultSource,
			projects:
				patch.projects !== undefined ? [...patch.projects] : current.projects,
			linkedNotes:
				patch.linkedNotes !== undefined
					? [...patch.linkedNotes]
					: current.linkedNotes,
			body: patch.body !== undefined ? patch.body : current.body,
			...(nextExtra && Object.keys(nextExtra).length > 0
				? { extraFrontmatter: nextExtra }
				: {}),
		};

		const saved = await this.writeVaultFile(
			paths.coreNote,
			serializeCoreNoteContent(merged)
		);

		if (
			patch.projects !== undefined &&
			literatureFile &&
			this.app.fileManager?.processFrontMatter
		) {
			const projKey = settings.projectFrontmatterKey || 'projects';
			await this.app.fileManager.processFrontMatter(
				literatureFile,
				(frontmatter) => {
					frontmatter[projKey] = [...merged.projects];
				}
			);
		}

		return saved;
	}

	async updateLiteratureCodeUrl(
		literatureFile: TFile,
		codeUrl: string
	): Promise<void> {
		const trimmed = codeUrl.trim();
		const processFm = (
			this.app as unknown as {
				fileManager?: {
					processFrontMatter?: (
						f: TFile,
						cb: (frontmatter: Record<string, unknown>) => void
					) => Promise<void>;
				};
			}
		).fileManager?.processFrontMatter;

		if (typeof processFm === 'function') {
			await processFm.call(this.app.fileManager, literatureFile, (fm) => {
				fm['code'] = trimmed;
			});
			return;
		}

		const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		const raw = await this.app.vault.read(literatureFile);
		const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n?[\s\S]*)$/);
		if (fmMatch) {
			const fmBody = fmMatch[1];
			const rest = fmMatch[2];
			const codeLineRe = /^code[ \t]*:.*$/m;
			const nextFmBody = codeLineRe.test(fmBody)
				? fmBody.replace(codeLineRe, () => `code: "${escaped}"`)
				: `${fmBody}\ncode: "${escaped}"`;
			await this.app.vault.modify(
				literatureFile,
				`---\n${nextFmBody}\n---${rest}`
			);
		} else {
			await this.app.vault.modify(
				literatureFile,
				`---\ncode: "${escaped}"\n---\n\n${raw}`
			);
		}
	}

	getBuiltInDefaultContent(id: string): string | null {
		switch (id) {
			case 'zotero-template':
				return DEFAULT_ZOTERO_TEMPLATE;
			case 'tpl-report1':
				return DEFAULT_REPORT1_NOTE_TEMPLATE;
			case 'tpl-report2':
				return DEFAULT_REPORT2_NOTE_TEMPLATE;
			case 'tpl-takeaway':
				return DEFAULT_TAKEAWAY_NOTE_TEMPLATE;
			case 'tpl-core-note':
				return DEFAULT_CORE_NOTE_TEMPLATE;
			case 'tpl-atomic-note':
				return DEFAULT_ATOMIC_NOTE_TEMPLATE;
			case 'synthesize':
				return DEFAULT_SYNTHESIZE_PROMPT;
			case 'report1':
				return DEFAULT_REPORT1_PROMPT;
			case 'report2':
				return DEFAULT_REPORT2_PROMPT;
			default:
				return null;
		}
	}

	async ensureBuiltinTemplatesInVault(): Promise<number> {
		if (typeof this.app.vault.create !== 'function') return 0;

		const settings = this.getSettings();
		const templatesFolder = normalizePath(
			settings.paperWorkspace?.templatesFolder?.trim() ||
				DEFAULT_PAPER_WORKSPACE.templatesFolder
		).replace(/\/+$/, '');
		await this.ensureFolderExists(templatesFolder);

		let createdCount = 0;

		const rawZotPath =
			settings.zoteroTemplate?.vaultPath?.trim() ||
			`${templatesFolder}/zotero-note-template.md`;
		const zotPath = normalizePath(
			/\.[^/\\]+$/.test(rawZotPath) ? rawZotPath : `${rawZotPath}.md`
		);
		if (settings.zoteroTemplate && !settings.zoteroTemplate.vaultPath?.trim()) {
			settings.zoteroTemplate.vaultPath = zotPath;
		}
		if (
			!this.getVaultFile(zotPath) &&
			!this.app.vault.getAbstractFileByPath(zotPath)
		) {
			await this.ensureParentFolder(zotPath);
			const zotContent =
				settings.zoteroTemplate?.content || DEFAULT_ZOTERO_TEMPLATE;
			await this.app.vault.create(zotPath, zotContent);
			createdCount += 1;
		}

		for (const entry of settings.prompts || []) {
			const defaultFilename =
				entry.kind === 'template'
					? `${entry.id.replace(/^tpl-/, '')}-note-template.md`
					: `prompt-${entry.id}.md`;
			const rawEntryPath =
				entry.vaultPath?.trim() || `${templatesFolder}/${defaultFilename}`;
			const entryPath = normalizePath(
				rawEntryPath.toLowerCase().endsWith('.md')
					? rawEntryPath
					: `${rawEntryPath}.md`
			);
			if (!entry.vaultPath?.trim()) {
				entry.vaultPath = entryPath;
			}
			if (
				!this.getVaultFile(entryPath) &&
				!this.app.vault.getAbstractFileByPath(entryPath)
			) {
				await this.ensureParentFolder(entryPath);
				const initialContent =
					entry.content || this.getBuiltInDefaultContent(entry.id) || '';
				await this.app.vault.create(entryPath, initialContent);
				createdCount += 1;
			}
		}

		return createdCount;
	}

	async moveTemplatesFolder(oldFolder: string, newFolder: string): Promise<number> {
		const oldNorm = normalizePath(oldFolder.trim()).replace(/\/+$/, '');
		const newNorm = normalizePath(newFolder.trim()).replace(/\/+$/, '');
		if (!oldNorm || !newNorm || oldNorm === newNorm) return 0;

		await this.ensureFolderExists(newNorm);

		const settings = this.getSettings();
		const oldPrefix = `${oldNorm}/`;
		let movedCount = 0;

		const relocateVaultPath = async (
			currentRawPath: string
		): Promise<string | null> => {
			const trimmed = currentRawPath.trim();
			if (!trimmed) return null;
			const currentNorm = normalizePath(trimmed);
			if (!currentNorm.startsWith(oldPrefix)) return null;

			const relSubpath = currentNorm.slice(oldPrefix.length);
			if (!relSubpath) return null;
			const destPath = normalizePath(`${newNorm}/${relSubpath}`);
			await this.ensureParentFolder(destPath);

			const srcFile = this.getVaultFile(currentNorm);
			const destExisting = this.app.vault.getAbstractFileByPath(destPath);
			if (srcFile && !destExisting) {
				const renameFn = (
					this.app as unknown as {
						fileManager?: {
							renameFile?: (
								file: TFile,
								newPath: string
							) => Promise<void>;
						};
					}
				).fileManager?.renameFile;
				if (typeof renameFn === 'function') {
					await renameFn.call(this.app.fileManager, srcFile, destPath);
				} else if (typeof this.app.vault.create === 'function') {
					const content = await this.app.vault.read(srcFile);
					await this.app.vault.create(destPath, content);
					await (
						this.app.vault as unknown as {
							delete?: (f: TFile) => Promise<void>;
						}
					).delete?.(srcFile);
				}
			}
			return destPath;
		};

		if (settings.zoteroTemplate?.vaultPath) {
			const nextZot = await relocateVaultPath(settings.zoteroTemplate.vaultPath);
			if (nextZot) {
				settings.zoteroTemplate.vaultPath = nextZot;
				movedCount += 1;
			}
		}

		for (const entry of settings.prompts || []) {
			if (!entry.vaultPath) continue;
			const nextPath = await relocateVaultPath(entry.vaultPath);
			if (nextPath) {
				entry.vaultPath = nextPath;
				movedCount += 1;
			}
		}

		return movedCount;
	}

	async getPromptContent(promptId: string): Promise<string> {
		const entry = this.getSettings().prompts.find((p) => p.id === promptId);
		if (!entry) return '';
		if (entry.vaultPath?.trim()) {
			const vaultFile = this.getVaultFile(entry.vaultPath.trim());
			if (vaultFile) {
				return await this.app.vault.read(vaultFile);
			}
		}
		return entry.content;
	}

	async savePromptToVault(
		entry: PromptTemplateEntry,
		content: string
	): Promise<string> {
		const folder = normalizePath(
			this.getSettings().paperWorkspace?.templatesFolder?.trim() ||
				DEFAULT_PAPER_WORKSPACE.templatesFolder
		).replace(/\/+$/, '');
		const defaultFile =
			entry.kind === 'template'
				? `${entry.id.replace(/^tpl-/, '')}-note-template.md`
				: `prompt-${entry.id}.md`;
		const rawPath = (entry.vaultPath || `${folder}/${defaultFile}`).trim();
		const targetPath = normalizePath(
			rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`
		);
		await this.writeVaultFile(targetPath, content);
		return targetPath;
	}
}
