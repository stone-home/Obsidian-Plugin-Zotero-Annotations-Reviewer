import { App, TFile } from 'obsidian';
import yaml from 'js-yaml';
import {
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

const INVALID_URL_TOKENS = new Set(['null', 'none', 'n/a', 'na', 'unknown', 'tbd', '-']);

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
	const thoughtSection = markdown.match(/(?:^|\r?\n)##\s+Thoughts\s*\r?\n([\s\S]*?)(?=\r?\n##\s+|$)/i);
	if (thoughtSection) {
		const cleaned = thoughtSection[1]
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !/^Comment at\s+/i.test(line))
			.join(' ');
		if (cleaned) return cleaned;
	}
	const highlightSection = markdown.match(/```ad-quote\s*\r?\n(?:title:[^\r\n]*\r?\n)?([\s\S]*?)```/i);
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
	if (pattern.trim().toLowerCase().endsWith('.md') && !normalized.toLowerCase().endsWith('.md')) {
		return `${normalized}.md`;
	}
	return normalized;
}

export function resolvePaperPaths(workspace: PaperWorkspaceConfig, citekey: string): ResolvedPaperPaths {
	const cleanKey = citekey.trim();
	const literatureNote = resolveCitekeyTemplate(workspace.literatureNotePath, cleanKey);
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
	const matches: Array<{ index: number; heading: string; start: number; bodyStart: number }> = [];

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
		const block = nextSectionIdx >= 0 ? rawSlice.slice(0, nextSectionIdx) : rawSlice;

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
				linkPath = bulletWiki.target.includes('/') ? bulletWiki.target.trim() : '';
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
				linkPath = headingWiki.target.includes('/') ? headingWiki.target.trim() : '';
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
			extractBulletValue(block, 'Potential Tags') || extractBulletValue(block, 'Tags');
		const tags = rawTags
			? rawTags
					.split(/[,;]+|\s+(?=#)/)
					.map((t) => t.trim().replace(/^#/, ''))
					.filter((t) => Boolean(t) && t !== '-' && !['none', 'n/a'].includes(t.toLowerCase()))
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

	const citekey = String(fm['citation-key'] ?? fm['citekey'] ?? fallbackCitekey).trim();
	const source = String(fm['source'] ?? (citekey ? `[[${citekey}]]` : '')).trim();
	const projects = toStringList(fm['projects']);
	const linkedNotes = toStringList(fm['linked-notes'] ?? fm['linkedNotes']);

	return {
		citekey,
		source,
		projects,
		linkedNotes,
		body: fmMatch[2].trim(),
	};
}

export function serializeCoreNoteContent(data: CoreNoteData): string {
	const fmObj: Record<string, unknown> = {
		'citation-key': data.citekey,
		type: 'paper-note',
		source: data.source || (data.citekey ? `[[${data.citekey}]]` : ''),
		projects: data.projects,
		'linked-notes': data.linkedNotes,
	};
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

	async ensureParentFolder(filePath: string): Promise<void> {
		const normalized = normalizePath(filePath);
		const folders = normalized.split('/').slice(0, -1).filter(Boolean);
		let current = '';
		for (const segment of folders) {
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
			settings.paperWorkspace.highlightNotesFolder || settings.fleetingNoteFolder || ''
		);
		const highlightPrefix = highlightFolder ? `${highlightFolder}/` : '';

		const fleetingFiles = this.app.vault.getMarkdownFiles().filter((candidate) => {
			if (candidate.path === file.path) return false;
			if (highlightPrefix && !candidate.path.startsWith(highlightPrefix)) return false;
			const candKey = this.getCitekeyForFile(candidate);
			return Boolean(candKey && candKey.replace(/^@/, '').toLowerCase() === cleanCitekey);
		});

		const [coreNoteRaw, takeawayRaw, report2Raw, fleetingContents] = await Promise.all([
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
		const litProjects = toStringList(fm[settings.projectFrontmatterKey || 'projects']);
		const projects = Array.from(new Set([...litProjects, ...coreNote.projects]));

		const fmCodeUrl = normalizeHttpUrl(fm['code']);
		const report2CodeUrl = report2Raw ? extractCodeUrlFromReport(report2Raw) : null;
		const codeUrl = fmCodeUrl ?? report2CodeUrl;

		if (
			!fmCodeUrl &&
			report2CodeUrl &&
			(!fm['code'] || !String(fm['code']).trim()) &&
			(this.app as unknown as {
				fileManager?: {
					processFrontMatter?: (
						f: TFile,
						cb: (frontmatter: Record<string, unknown>) => void
					) => Promise<void>;
				};
			}).fileManager?.processFrontMatter
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
		const paths = resolvePaperPaths(this.getSettings().paperWorkspace, citekey);
		const targetPath = normalizePath(paths[kind]);
		const existing = this.getVaultFile(targetPath);
		if (existing) return existing;

		if (kind === 'coreNote') {
			return await this.saveCoreNote(citekey, {}, literatureFile);
		}

		await this.ensureParentFolder(targetPath);
		return await this.app.vault.create(targetPath, '');
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

		const headingRe = new RegExp(`^###\\s+Candidate\\s+${candidateIndex}\\b[^\\r\\n]*`, 'im');
		const headingMatch = headingRe.exec(md);
		if (!headingMatch) return false;

		const sectionBodyStart = headingMatch.index + headingMatch[0].length;
		const afterHeading = md.slice(sectionBodyStart);
		const nextBoundary = afterHeading.match(/\r?\n(?:###\s+Candidate\s+\d+\b|##\s+)/i);
		const sectionBodyEnd =
			nextBoundary && nextBoundary.index !== undefined
				? sectionBodyStart + nextBoundary.index
				: md.length;

		let sectionBody = md.slice(sectionBodyStart, sectionBodyEnd);
		const linkLineRe = /^[ \t]*[-*][ \t]*(?:\*\*)?Link(?:\*\*)?[ \t]*[:：][ \t]*.+$/im;
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
		const markdown = kind === 'takeaway' ? unwrapTakeawayMarkdown(rawContent) : rawContent;
		const savedFile = await this.writeVaultFile(targetPath, markdown);

		const extractedCodeUrl = kind === 'report2' ? extractCodeUrlFromReport(markdown) : null;
		if (extractedCodeUrl && literatureFile && this.app.fileManager?.processFrontMatter) {
			await this.app.fileManager.processFrontMatter(literatureFile, (frontmatter) => {
				if (!frontmatter['code'] || !String(frontmatter['code']).trim()) {
					frontmatter['code'] = extractedCodeUrl;
				}
			});
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

		const merged: CoreNoteData = {
			citekey,
			source: patch.source !== undefined ? patch.source : current.source || defaultSource,
			projects: patch.projects !== undefined ? [...patch.projects] : current.projects,
			linkedNotes:
				patch.linkedNotes !== undefined ? [...patch.linkedNotes] : current.linkedNotes,
			body: patch.body !== undefined ? patch.body : current.body,
		};

		const saved = await this.writeVaultFile(paths.coreNote, serializeCoreNoteContent(merged));

		if (
			patch.projects !== undefined &&
			literatureFile &&
			this.app.fileManager?.processFrontMatter
		) {
			const projKey = settings.projectFrontmatterKey || 'projects';
			await this.app.fileManager.processFrontMatter(literatureFile, (frontmatter) => {
				frontmatter[projKey] = [...merged.projects];
			});
		}

		return saved;
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

	async savePromptToVault(entry: PromptTemplateEntry, content: string): Promise<string> {
		const rawPath = (entry.vaultPath || `002-Literature/100-Prompts/${entry.id}.md`).trim();
		const targetPath = normalizePath(rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`);
		await this.writeVaultFile(targetPath, content);
		return targetPath;
	}
}
