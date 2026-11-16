import { App, TFile } from 'obsidian';
import {
	DEFAULT_PAPER_WORKSPACE,
	DEFAULT_SETTINGS,
	DEFAULT_ZOTERO_TEMPLATE,
	MyPluginSettings,
	PromptTemplateEntry,
} from '../types';
import {
	buildS3Uri,
	CoreNoteData,
	extractCodeUrlFromReport,
	extractTakeawaySummary,
	PaperHubService,
	parseCoreNoteContent,
	parseTakeawayCandidates,
	resolveCitekeyTemplate,
	resolvePaperPaths,
	serializeCoreNoteContent,
	unwrapTakeawayMarkdown,
} from './paper-hub';
import { ZoteroConnectorService } from './zotero-connector';

function makeVaultFile(path: string, mtime = 1000): TFile {
	const file = new TFile();
	const name = path.split('/').pop() || path;
	const basename = name.replace(/\.md$/i, '');
	Object.assign(file, {
		path,
		name,
		basename,
		extension: 'md',
		stat: { mtime, ctime: mtime, size: 128 },
	});
	return file;
}

describe('paper-hub pure helpers', () => {
	describe('resolveCitekeyTemplate', () => {
		it('replaces {{citekey}}, {{citation-key}}, and ${citekey} placeholders and normalizes slashes', () => {
			expect(resolveCitekeyTemplate('002-Literature\\{{citekey}}.md', ' smith2024 ')).toBe(
				'002-Literature/smith2024.md'
			);
			expect(
				resolveCitekeyTemplate('/002-Literature/{{ citation-key }}/note-${citekey}.md', 'lecun1998')
			).toBe('002-Literature/lecun1998/note-lecun1998.md');
			expect(resolveCitekeyTemplate('./001-Fleeting', 'lecun1998')).toBe('001-Fleeting');
		});
	});

	describe('buildS3Uri', () => {
		it('preserves s3://bucket/prefix without collapsing double slashes', () => {
			expect(
				buildS3Uri('s3://my-bucket/obsidian-vault/', '/002-Literature\\smith2024.md')
			).toBe('s3://my-bucket/obsidian-vault/002-Literature/smith2024.md');
			expect(buildS3Uri('s3://my-bucket', '002-Literature/smith2024.md')).toBe(
				's3://my-bucket/002-Literature/smith2024.md'
			);
		});

		it('handles plain folder prefixes, empty prefixes, and empty relative paths', () => {
			expect(buildS3Uri('vault-backup/main/', '002-Literature/smith2024.md')).toBe(
				'vault-backup/main/002-Literature/smith2024.md'
			);
			expect(buildS3Uri('   ', '/002-Literature/smith2024.md')).toBe(
				'002-Literature/smith2024.md'
			);
			expect(buildS3Uri('s3://my-bucket/prefix/', '')).toBe('s3://my-bucket/prefix');
		});
	});

	describe('resolvePaperPaths', () => {
		it('resolves all five workspace paths and corresponding S3 URIs', () => {
			const resolved = resolvePaperPaths(
				{
					...DEFAULT_PAPER_WORKSPACE,
					s3Prefix: 's3://research-vault/notes',
				},
				'vaswani2017'
			);

			expect(resolved.citekey).toBe('vaswani2017');
			expect(resolved.literatureNote).toBe('002-Literature/vaswani2017.md');
			expect(resolved.report1).toBe(
				'002-Literature/102-Analysis Report/Deep Research-vaswani2017.md'
			);
			expect(resolved.report2).toBe(
				'002-Literature/103-External Analysis Report/External Research-vaswani2017.md'
			);
			expect(resolved.takeaway).toBe(
				'002-Literature/101-Takeaways/Takeaway-vaswani2017.md'
			);
			expect(resolved.coreNote).toBe('002-Literature/104-Paper Notes/vaswani2017.md');
			expect(resolved.s3).toEqual({
				literatureNote: 's3://research-vault/notes/002-Literature/vaswani2017.md',
				report1:
					's3://research-vault/notes/002-Literature/102-Analysis Report/Deep Research-vaswani2017.md',
				report2:
					's3://research-vault/notes/002-Literature/103-External Analysis Report/External Research-vaswani2017.md',
				takeaway:
					's3://research-vault/notes/002-Literature/101-Takeaways/Takeaway-vaswani2017.md',
				coreNote:
					's3://research-vault/notes/002-Literature/104-Paper Notes/vaswani2017.md',
			});
		});
	});

	describe('extractCodeUrlFromReport', () => {
		it('extracts valid http(s) URL from fenced JSON blocks', () => {
			const md = [
				'# External Report',
				'```json',
				'{ "code_url": "https://github.com/org/awesome-paper" }',
				'```',
			].join('\n');
			expect(extractCodeUrlFromReport(md)).toBe('https://github.com/org/awesome-paper');
		});

		it('skips malformed or null fenced blocks and falls back to inline JSON match', () => {
			const mdWithFallback = [
				'```json',
				'{ broken json',
				'```',
				'```',
				'{ "code_url": null }',
				'```',
				'Discovered artifact: {"code_url": "http://gitlab.com/lab/repro"}',
			].join('\n');
			expect(extractCodeUrlFromReport(mdWithFallback)).toBe('http://gitlab.com/lab/repro');
		});

		it('ignores null, N/A, placeholder tokens, non-http schemes, and empty input', () => {
			expect(extractCodeUrlFromReport('')).toBeNull();
			expect(extractCodeUrlFromReport('```json\n{"code_url": "N/A"}\n```')).toBeNull();
			expect(extractCodeUrlFromReport('```json\n{"code_url": "null"}\n```')).toBeNull();
			expect(extractCodeUrlFromReport('```json\n{"code_url": "unknown"}\n```')).toBeNull();
			expect(
				extractCodeUrlFromReport('{"code_url": "git@github.com:org/repo.git"}')
			).toBeNull();
			expect(extractCodeUrlFromReport('No code block at all')).toBeNull();
		});
	});

	describe('unwrapTakeawayMarkdown, extractTakeawaySummary, and parseTakeawayCandidates', () => {
		const sampleMarkdown = [
			'## 💡 Candidate Atomic Zettels',
			'',
			'### Candidate 1: [[A - Systems - Caching - Lease Based Invalidation|Lease Invalidation]]',
			'- **Link Status**: Proposed',
			'- **Storyline**: Prevents stale reads without per-read coordination',
			'- **Evidence**: 2.4x higher throughput on YCSB-B',
			'- **Brief**: Short leases allow lock-free local reads while bounding staleness.',
			'- **Related Papers**: nishtala2013, 10.1145/2485732.2485740',
			'- **Tags**: systems/cache, #distributed #consistency',
			'',
			'### Candidate 2 - Plain Candidate Heading',
			'- Link Status: Existing',
			'',
			'## 📊 Research Profile',
			'',
			'- 💊 **TL;DR**:: Lease-based cache coherence eliminates read locks at scale.',
			'- 🩻 **topic**:: Distributed storage and cache consistency.',
			'- 💎 **novelty**:: Adaptive lease extension under skewed read-heavy workloads.',
			'- 📌 **limitation**:: Tail latency spikes during lease revocation storms.',
		].join('\n');

		it('unwraps JSON envelope with markdown_body and preserves raw or invalid JSON strings', () => {
			const wrapped = JSON.stringify({
				filename_suggestion: 'Takeaway-smith2024',
				markdown_body: sampleMarkdown,
			});
			expect(unwrapTakeawayMarkdown(`  ${wrapped}\n`)).toBe(sampleMarkdown);
			expect(unwrapTakeawayMarkdown(sampleMarkdown)).toBe(sampleMarkdown);
			expect(unwrapTakeawayMarkdown('{ invalid json')).toBe('{ invalid json');
			expect(unwrapTakeawayMarkdown('{"other_key": 42}')).toBe('{"other_key": 42}');
		});

		it('extracts TL;DR, topic, novelty, and limitation from both wrapped and raw markdown', () => {
			const wrapped = JSON.stringify({ markdown_body: sampleMarkdown });
			expect(extractTakeawaySummary(wrapped)).toEqual({
				tldr: 'Lease-based cache coherence eliminates read locks at scale.',
				topic: 'Distributed storage and cache consistency.',
				novelty: 'Adaptive lease extension under skewed read-heavy workloads.',
				limitation: 'Tail latency spikes during lease revocation storms.',
			});
			expect(extractTakeawaySummary('# Empty Takeaway')).toEqual({
				tldr: '',
				topic: '',
				novelty: '',
				limitation: '',
			});
		});

		it('parses multiple candidates, wiki-link titles, tags, and missing bullet fields', () => {
			const candidates = parseTakeawayCandidates(sampleMarkdown);
			expect(candidates).toHaveLength(2);
			expect(candidates[0]).toEqual({
				index: 1,
				heading: '[[A - Systems - Caching - Lease Based Invalidation|Lease Invalidation]]',
				linkTitle: 'A - Systems - Caching - Lease Based Invalidation',
				linkStatus: 'Proposed',
				storyline: 'Prevents stale reads without per-read coordination',
				evidence: '2.4x higher throughput on YCSB-B',
				brief: 'Short leases allow lock-free local reads while bounding staleness.',
				relatedPapers: 'nishtala2013, 10.1145/2485732.2485740',
				tags: ['systems/cache', 'distributed', 'consistency'],
			});
			expect(candidates[1]).toEqual({
				index: 2,
				heading: 'Plain Candidate Heading',
				linkTitle: 'Plain Candidate Heading',
				linkStatus: 'Existing',
				storyline: '',
				evidence: '',
				brief: '',
				relatedPapers: '',
				tags: [],
			});
		});
	});

	describe('parseCoreNoteContent and serializeCoreNoteContent', () => {
		it('round-trips CoreNoteData with YAML frontmatter and markdown body', () => {
			const input: CoreNoteData = {
				citekey: 'smith2024',
				source: '[[002-Literature/smith2024|smith2024]]',
				projects: ['[[Projects/CacheProj|CacheProj]]'],
				linkedNotes: ['[[A - Systems - Caching - Lease Based Invalidation]]'],
				body: 'Core claim: bounded leases outperform quorum reads.\n\nSecond paragraph.',
			};
			const serialized = serializeCoreNoteContent(input);
			const parsed = parseCoreNoteContent(serialized);
			expect(parsed).toEqual(input);
		});

		it('serializes empty body cleanly and handles scalar strings, missing frontmatter, and invalid YAML', () => {
			const emptyBodySerialized = serializeCoreNoteContent({
				citekey: 'jones2023',
				source: '',
				projects: [],
				linkedNotes: [],
				body: '   ',
			});
			expect(emptyBodySerialized.endsWith('---\n')).toBe(true);
			expect(parseCoreNoteContent(emptyBodySerialized)).toEqual({
				citekey: 'jones2023',
				source: '[[jones2023]]',
				projects: [],
				linkedNotes: [],
				body: '',
			});

			// Scalar string values & alternate frontmatter keys
			const scalarYaml = [
				'---',
				'citekey: scalar2022',
				'projects: "[[SingleProj]]"',
				'linkedNotes: "[[SingleAtom]]"',
				'---',
				'Scalar body',
			].join('\n');
			expect(parseCoreNoteContent(scalarYaml)).toEqual({
				citekey: 'scalar2022',
				source: '[[scalar2022]]',
				projects: ['[[SingleProj]]'],
				linkedNotes: ['[[SingleAtom]]'],
				body: 'Scalar body',
			});

			// No frontmatter with fallbackCitekey and without fallbackCitekey
			expect(parseCoreNoteContent('Plain body note', 'fallback2025')).toEqual({
				citekey: 'fallback2025',
				source: '[[fallback2025]]',
				projects: [],
				linkedNotes: [],
				body: 'Plain body note',
			});
			expect(parseCoreNoteContent('Plain body no key')).toEqual({
				citekey: '',
				source: '',
				projects: [],
				linkedNotes: [],
				body: 'Plain body no key',
			});

			// Invalid YAML fallback
			const brokenYaml = '---\n: [unclosed\n---\nRecovered body';
			expect(parseCoreNoteContent(brokenYaml, 'rec2024')).toEqual({
				citekey: 'rec2024',
				source: '[[rec2024]]',
				projects: [],
				linkedNotes: [],
				body: 'Recovered body',
			});
		});
	});
});

describe('PaperHubService', () => {
	let app: App;
	let settings: MyPluginSettings;
	let service: PaperHubService;
	let vaultFiles: Map<string, TFile>;
	let vaultContents: Map<string, string>;
	let frontmatters: Map<string, Record<string, any>>;

	beforeEach(() => {
		app = new App();
		vaultFiles = new Map();
		vaultContents = new Map();
		frontmatters = new Map();

		settings = {
			...DEFAULT_SETTINGS,
			paperWorkspace: { ...DEFAULT_PAPER_WORKSPACE, s3Prefix: 's3://bucket/vault' },
			prompts: DEFAULT_SETTINGS.prompts.map((p) => ({ ...p })),
		};

		(app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
			(p: string) => vaultFiles.get(p) ?? null
		);
		(app.vault.getMarkdownFiles as jest.Mock).mockImplementation(() =>
			Array.from(vaultFiles.values())
		);
		(app.vault.read as jest.Mock).mockImplementation(
			async (f: TFile) => vaultContents.get(f.path) ?? ''
		);
		(app.vault.modify as jest.Mock).mockImplementation(
			async (f: TFile, content: string) => {
				vaultContents.set(f.path, content);
			}
		);
		(app.vault as any).create = jest
			.fn()
			.mockImplementation(async (p: string, content: string) => {
				const f = makeVaultFile(p);
				vaultFiles.set(p, f);
				vaultContents.set(p, content);
				return f;
			});
		(app as any).fileManager = {
			processFrontMatter: jest.fn(
				async (file: TFile, fn: (fm: Record<string, any>) => void) => {
					const fm = frontmatters.get(file.path) ?? {};
					fn(fm);
					frontmatters.set(file.path, fm);
				}
			),
		};
		(app.metadataCache.getFileCache as jest.Mock).mockImplementation((f: TFile) => {
			const fm = frontmatters.get(f.path);
			return fm ? { frontmatter: fm } : null;
		});

		service = new PaperHubService(app, () => settings);
	});

	it('getCitekeyForFile resolves custom key, fallback keys, or returns null when absent', () => {
		const f1 = makeVaultFile('002-Literature/a.md');
		expect(service.getCitekeyForFile(f1)).toBeNull();

		frontmatters.set(f1.path, { 'zotero-key': '  zot2024  ' });
		expect(service.getCitekeyForFile(f1)).toBe('zot2024');

		frontmatters.set(f1.path, { 'citation-key': '   ' });
		expect(service.getCitekeyForFile(f1)).toBeNull();
	});

	it('ensureParentFolder creates nested folders, ignores already-exists race, and rethrows fatal errors', async () => {
		(app.vault.createFolder as jest.Mock)
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error('Folder already exists'));

		await expect(
			service.ensureParentFolder('002-Literature/101-Takeaways/Takeaway-k.md')
		).resolves.toBeUndefined();
		expect(app.vault.createFolder).toHaveBeenCalledWith('002-Literature');
		expect(app.vault.createFolder).toHaveBeenCalledWith('002-Literature/101-Takeaways');

		(app.vault.createFolder as jest.Mock).mockRejectedValueOnce(new Error('Permission denied'));
		await expect(service.ensureParentFolder('009-Locked/note.md')).rejects.toThrow(
			'Permission denied'
		);
	});

	it('getPaperState aggregates companion files, fleeting thoughts, merged projects, and fallback code/DOI URLs', async () => {
		const litFile = makeVaultFile('002-Literature/smith2024.md');
		vaultFiles.set(litFile.path, litFile);
		frontmatters.set(litFile.path, {
			'citation-key': 'smith2024',
			projects: ['[[ProjA]]'],
			code: 'N/A',
			doi: 'doi: 10.1145/999999',
		});

		const paths = resolvePaperPaths(settings.paperWorkspace, 'smith2024');
		const coreFile = makeVaultFile(paths.coreNote);
		const takeawayFile = makeVaultFile(paths.takeaway);
		const report2File = makeVaultFile(paths.report2);
		vaultFiles.set(coreFile.path, coreFile);
		vaultFiles.set(takeawayFile.path, takeawayFile);
		vaultFiles.set(report2File.path, report2File);

		vaultContents.set(
			coreFile.path,
			serializeCoreNoteContent({
				citekey: 'smith2024',
				source: '[[002-Literature/smith2024|smith2024]]',
				projects: ['[[ProjA]]', '[[ProjB]]'],
				linkedNotes: ['[[A - Sys - Cache - Lease]]'],
				body: 'My synthesis.',
			})
		);
		vaultContents.set(
			takeawayFile.path,
			[
				'### Candidate 1: [[A - Sys - Cache - Lease]]',
				'- **Brief**: Atomic brief.',
				'## 📊 Research Profile',
				'- 💊 **TL;DR**:: Fast cache leases.',
			].join('\n')
		);
		vaultContents.set(
			report2File.path,
			'```json\n{"code_url": "https://github.com/smith/leases"}\n```'
		);

		const fl1 = makeVaultFile('001-Fleeting/hl-1.md');
		const fl2 = makeVaultFile('001-Fleeting/hl-2.md');
		const flOutside = makeVaultFile('999-Other/hl-3.md');
		vaultFiles.set(fl1.path, fl1);
		vaultFiles.set(fl2.path, fl2);
		vaultFiles.set(flOutside.path, flOutside);

		frontmatters.set(fl1.path, { 'citation-key': '@SMITH2024', read: true });
		frontmatters.set(fl2.path, { 'citation-key': 'smith2024', tags: ['note'] });
		frontmatters.set(flOutside.path, { 'citation-key': 'smith2024' });

		vaultContents.set(
			fl1.path,
			'## Thoughts\nComment at page 3\nKey insight on lease renewal.\n## Quote\ntext'
		);
		vaultContents.set(
			fl2.path,
			'```ad-quote\ntitle: Page 5\nHighlighted text from the PDF manuscript.\n```'
		);

		const state = await service.getPaperState(litFile);
		expect(state).not.toBeNull();
		expect(state!.citekey).toBe('smith2024');
		expect(state!.report1File).toBeNull();
		expect(state!.report2File).toBe(report2File);
		expect(state!.projects).toEqual(['[[ProjA]]', '[[ProjB]]']);
		expect(state!.codeUrl).toBe('https://github.com/smith/leases');
		expect(state!.doiUrl).toBe('https://doi.org/10.1145/999999');
		expect(state!.takeawaySummary.tldr).toBe('Fast cache leases.');
		expect(state!.takeawayCandidates).toHaveLength(1);
		expect(state!.fleetingNotes).toEqual([
			{ file: fl1, thought: 'Key insight on lease renewal.', read: true },
			{ file: fl2, thought: 'Highlighted text from the PDF manuscript.', read: false },
		]);
	});

	it('getPaperState handles missing companion files, full HTTP DOI/URL fallback, and unkeyed files', async () => {
		const unkeyed = makeVaultFile('002-Literature/unkeyed.md');
		expect(await service.getPaperState(unkeyed)).toBeNull();

		const bareLit = makeVaultFile('002-Literature/bare2025.md');
		vaultFiles.set(bareLit.path, bareLit);
		frontmatters.set(bareLit.path, {
			'citation-key': 'bare2025',
			url: 'https://arxiv.org/abs/2501.00001',
		});

		const state = await service.getPaperState(bareLit);
		expect(state).not.toBeNull();
		expect(state!.coreNoteFile).toBeNull();
		expect(state!.coreNote.source).toBe('[[002-Literature/bare2025|bare2025]]');
		expect(state!.doiUrl).toBe('https://arxiv.org/abs/2501.00001');
		expect(state!.codeUrl).toBeNull();
		expect(state!.takeawayCandidates).toEqual([]);
	});

	it('saveReportMarkdown unwraps takeaway JSON, modifies existing files, and syncs report2 code_url only when empty', async () => {
		const litFile = makeVaultFile('002-Literature/paper2024.md');
		frontmatters.set(litFile.path, { 'citation-key': 'paper2024', code: '' });

		// 1. Takeaway JSON unwrap (creates new file)
		const takeawayRes = await service.saveReportMarkdown(
			'paper2024',
			'takeaway',
			JSON.stringify({ markdown_body: '## 📊 Research Profile\n- 💊 **TL;DR**:: Unwrapped.' }),
			litFile
		);
		expect(takeawayRes.extractedCodeUrl).toBeNull();
		expect(vaultContents.get(takeawayRes.file.path)).toBe(
			'## 📊 Research Profile\n- 💊 **TL;DR**:: Unwrapped.'
		);

		// 2. Report 2 extracts code_url and sets empty frontmatter['code']
		const r2Res = await service.saveReportMarkdown(
			'paper2024',
			'report2',
			'Report\n```json\n{"code_url": "https://github.com/org/first"}\n```',
			litFile
		);
		expect(r2Res.extractedCodeUrl).toBe('https://github.com/org/first');
		expect(frontmatters.get(litFile.path)?.code).toBe('https://github.com/org/first');

		// 3. Modifying existing Report 2 does NOT overwrite non-empty frontmatter['code']
		await service.saveReportMarkdown(
			'paper2024',
			'report2',
			'Updated\n```json\n{"code_url": "https://github.com/org/second"}\n```',
			litFile
		);
		expect(app.vault.modify).toHaveBeenCalled();
		expect(frontmatters.get(litFile.path)?.code).toBe('https://github.com/org/first');
	});

	it('saveCoreNote creates and patches Core Note and syncs projects to literature frontmatter', async () => {
		const litFile = makeVaultFile('002-Literature/core2024.md');
		frontmatters.set(litFile.path, { 'citation-key': 'core2024' });

		const created = await service.saveCoreNote(
			'core2024',
			{
				projects: ['[[Proj1]]'],
				linkedNotes: ['[[A - Domain - Topic - Claim]]'],
				body: 'Initial draft.',
			},
			litFile
		);
		expect(frontmatters.get(litFile.path)?.projects).toEqual(['[[Proj1]]']);
		expect(parseCoreNoteContent(vaultContents.get(created.path)!)).toEqual({
			citekey: 'core2024',
			source: '[[002-Literature/core2024|core2024]]',
			projects: ['[[Proj1]]'],
			linkedNotes: ['[[A - Domain - Topic - Claim]]'],
			body: 'Initial draft.',
		});

		// Patch body only -> preserves projects & linkedNotes without touching frontmatter again
		await service.saveCoreNote('core2024', { body: 'Refined claim.' });
		expect(parseCoreNoteContent(vaultContents.get(created.path)!)).toEqual({
			citekey: 'core2024',
			source: '[[002-Literature/core2024|core2024]]',
			projects: ['[[Proj1]]'],
			linkedNotes: ['[[A - Domain - Topic - Claim]]'],
			body: 'Refined claim.',
		});
	});

	it('getPromptContent and savePromptToVault read/write vault prompt files with fallback', async () => {
		expect(await service.getPromptContent('nonexistent')).toBe('');

		// Fallback to in-memory content when vault file doesn't exist yet
		const synthDefault = await service.getPromptContent('synthesize');
		expect(synthDefault).toContain('Zettelkasten Incubator');

		// Save custom prompt without .md suffix -> auto-appends .md
		const customEntry: PromptTemplateEntry = {
			id: 'custom1',
			name: 'Custom 1',
			vaultPath: '002-Literature/100-Prompts/custom1',
			content: 'Fallback text',
		};
		settings.prompts.push(customEntry);
		const savedPath = await service.savePromptToVault(customEntry, '# Custom Vault Content');
		expect(savedPath).toBe('002-Literature/100-Prompts/custom1.md');
		customEntry.vaultPath = savedPath;

		expect(await service.getPromptContent('custom1')).toBe('# Custom Vault Content');
	});
});

describe('ZoteroConnectorService template management', () => {
	let app: App;
	let settings: MyPluginSettings;
	let connector: ZoteroConnectorService;
	let vaultFiles: Map<string, TFile>;
	let vaultContents: Map<string, string>;

	beforeEach(() => {
		app = new App();
		vaultFiles = new Map();
		vaultContents = new Map();
		settings = {
			...DEFAULT_SETTINGS,
			zoteroTemplate: {
				vaultPath: '',
				content: '',
			},
		};

		(app.vault.getAbstractFileByPath as jest.Mock).mockImplementation(
			(p: string) => vaultFiles.get(p) ?? null
		);
		(app.vault.read as jest.Mock).mockImplementation(
			async (f: TFile) => vaultContents.get(f.path) ?? ''
		);
		(app.vault.modify as jest.Mock).mockImplementation(
			async (f: TFile, content: string) => {
				vaultContents.set(f.path, content);
			}
		);
		(app.vault as any).create = jest
			.fn()
			.mockImplementation(async (p: string, content: string) => {
				const f = makeVaultFile(p);
				vaultFiles.set(p, f);
				vaultContents.set(p, content);
				return f;
			});

		(app as any).plugins = {
			getPlugin: jest.fn().mockReturnValue(null),
		};

		connector = new ZoteroConnectorService(app, settings);
	});

	it('detectTemplatePath resolves templatePath, templateFile, or null when unconfigured', () => {
		expect(connector.detectTemplatePath()).toBeNull();

		((app as any).plugins.getPlugin as jest.Mock).mockReturnValue({
			settings: { exportFormats: [{ templatePath: '000-Templates\\Zotero.md' }] },
		});
		expect(connector.detectTemplatePath()).toBe('000-Templates/Zotero.md');

		((app as any).plugins.getPlugin as jest.Mock).mockReturnValue({
			settings: { exportFormats: [{ templateFile: '  000-Templates/Alt.njk  ' }] },
		});
		expect(connector.detectTemplatePath()).toBe('000-Templates/Alt.njk');

		((app as any).plugins.getPlugin as jest.Mock).mockReturnValue({
			settings: { exportFormats: [{ templatePath: '   ' }] },
		});
		expect(connector.detectTemplatePath()).toBeNull();
	});

	it('loadTemplateContent loads from explicit or detected vault TFile and falls back to DEFAULT_ZOTERO_TEMPLATE', async () => {
		const fallbackResult = await connector.loadTemplateContent();
		expect(fallbackResult).toEqual({
			path: null,
			content: DEFAULT_ZOTERO_TEMPLATE,
			fromVault: false,
		});

		const tplFile = makeVaultFile('000-Templates/Zotero.md');
		vaultFiles.set(tplFile.path, tplFile);
		vaultContents.set(tplFile.path, 'Custom Nunjucks {{citekey}}');

		const loadedExplicit = await connector.loadTemplateContent('000-Templates/Zotero.md');
		expect(loadedExplicit).toEqual({
			path: '000-Templates/Zotero.md',
			content: 'Custom Nunjucks {{citekey}}',
			fromVault: true,
		});

		const missingVaultResult = await connector.loadTemplateContent('000-Templates/Missing.md');
		expect(missingVaultResult).toEqual({
			path: '000-Templates/Missing.md',
			content: DEFAULT_ZOTERO_TEMPLATE,
			fromVault: false,
		});
	});

	it('saveTemplateToVault validates non-empty path, appends .md when needed, creates folders, and modifies or creates', async () => {
		await expect(connector.saveTemplateToVault('   ', 'body')).rejects.toThrow(
			'Template vault path cannot be empty.'
		);

		const createdPath = await connector.saveTemplateToVault(
			'000-Templates/Sub/ZoteroNote',
			'v1 content'
		);
		expect(createdPath).toBe('000-Templates/Sub/ZoteroNote.md');
		expect(app.vault.createFolder).toHaveBeenCalledWith('000-Templates');
		expect(app.vault.createFolder).toHaveBeenCalledWith('000-Templates/Sub');
		expect(app.vault.create).toHaveBeenCalledWith(
			'000-Templates/Sub/ZoteroNote.md',
			'v1 content'
		);

		const modifiedPath = await connector.saveTemplateToVault(
			'000-Templates/Sub/ZoteroNote.md',
			'v2 content'
		);
		expect(modifiedPath).toBe('000-Templates/Sub/ZoteroNote.md');
		expect(app.vault.modify).toHaveBeenCalled();
		expect(vaultContents.get('000-Templates/Sub/ZoteroNote.md')).toBe('v2 content');
	});
});
