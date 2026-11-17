import { App, Notice, TFile } from 'obsidian';
import yaml from 'js-yaml';
import {
	DEFAULT_PAPER_WORKSPACE,
	DEFAULT_SETTINGS,
	DEFAULT_ZOTERO_TEMPLATE,
	MyPluginSettings,
	PromptTemplateEntry,
} from '../types';
import {
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

jest.mock('obsidian', () => ({
	...jest.requireActual('obsidian'),
	Notice: jest.fn(),
}));

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

	describe('DEFAULT_ZOTERO_TEMPLATE Nunjucks & YAML contracts', () => {
		function simulateNunjucksAuthorsBlock(template: string, authorsValue: string): string {
			const match = template.match(
				/authors:[\s\S]*?create: \{\{date \| format\("YYYY-MM-DD"\)\}\}/
			);
			if (!match) {
				throw new Error('Could not locate authors..create block in DEFAULT_ZOTERO_TEMPLATE');
			}
			const rawBlock = match[0];

			// Apply Nunjucks tag whitespace trimming: {%- strips preceding whitespace, -%} strips following whitespace
			const parts = rawBlock.split(/(\{%-?\s*[\s\S]*?\s*-?%\})/);
			for (let i = 1; i < parts.length; i += 2) {
				const tag = parts[i];
				if (tag.startsWith('{%-')) {
					parts[i - 1] = parts[i - 1].replace(/\s+$/, '');
				}
				if (tag.endsWith('-%}')) {
					parts[i + 1] = parts[i + 1].replace(/^\s+/, '');
				}
			}
			expect(parts).toHaveLength(9);

			const renderAuthorExpr = (text: string, author: string): string =>
				text.replace(
					/\{\{\s*author\s*\|\s*trim\s*\|\s*replace\(" ", "-"\)\s*\|\s*replace\("\.", ""\)\s*\}\}/g,
					author.trim().replace(/ /g, '-').replace(/\./g, '')
				);

			let rendered = parts[0];
			if (authorsValue) {
				rendered += parts[2];
				for (const item of authorsValue.split(',')) {
					rendered += renderAuthorExpr(parts[4], item);
				}
				rendered += parts[6];
			}
			rendered += parts[8].replace('{{date | format("YYYY-MM-DD")}}', '"2024-05-01"');
			return rendered;
		}

		it('omits trailing -%} in authors loop tags and renders valid YAML list or null with create on its own line', () => {
			const authorsSectionMatch = DEFAULT_ZOTERO_TEMPLATE.match(
				/authors:[\s\S]*?create: \{\{date \| format\("YYYY-MM-DD"\)\}\}/
			);
			expect(authorsSectionMatch).not.toBeNull();
			expect(authorsSectionMatch![0]).not.toContain('-%}');
			expect(DEFAULT_ZOTERO_TEMPLATE).not.toMatch(/\{%-?\s*for\s+author[^%]*-%\}/);
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain('{%- if authors %}');
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain('{%- for author in authors.split(",") %}');
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain('{%- endfor %}\n{%- endif %}\ncreate:');

			const renderedWithAuthors = simulateNunjucksAuthorsBlock(
				DEFAULT_ZOTERO_TEMPLATE,
				'Kaiyuan Tian, Linbo. Qiao'
			);
			expect(renderedWithAuthors).not.toContain('authors:-');
			expect(renderedWithAuthors).toBe(
				'authors:\n  - Kaiyuan-Tian\n  - Linbo-Qiao\ncreate: "2024-05-01"'
			);
			expect(yaml.load(renderedWithAuthors)).toEqual({
				authors: ['Kaiyuan-Tian', 'Linbo-Qiao'],
				create: '2024-05-01',
			});

			const renderedEmptyAuthors = simulateNunjucksAuthorsBlock(DEFAULT_ZOTERO_TEMPLATE, '');
			expect(renderedEmptyAuthors).toBe('authors:\ncreate: "2024-05-01"');
			expect(yaml.load(renderedEmptyAuthors)).toEqual({
				authors: null,
				create: '2024-05-01',
			});
		});

		it('resolves conferencePaper venue from (conferenceName or proceedingsTitle)', () => {
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain(
				"((conferenceName or proceedingsTitle) if itemType == 'conferencePaper' else '')"
			);
		});

		it('restores legacy deep-report, external-report, and persistent properties block', () => {
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain('deep-report:');
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain("att.title == 'deep-report'");
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain('external-report:');
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain("att.title == 'external-report'");
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain('## 💾 Persistent Data');
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain('{% persist "properties" %}');
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain('{% endpersist %}');
		});
	});

	describe('resolvePaperPaths', () => {
		it('resolves all five vault-relative workspace paths without S3 fields', () => {
			const resolved = resolvePaperPaths(DEFAULT_PAPER_WORKSPACE, ' vaswani2017 ');

			expect(resolved).toEqual({
				citekey: 'vaswani2017',
				literatureNote: '002-Literature/vaswani2017.md',
				report1: '002-Literature/102-Analysis Report/Deep Research-vaswani2017.md',
				report2:
					'002-Literature/103-External Analysis Report/External Research-vaswani2017.md',
				takeaway: '002-Literature/101-Takeaways/Takeaway-vaswani2017.md',
				coreNote: '002-Literature/104-Paper Notes/vaswani2017.md',
			});
			expect('s3' in (resolved as unknown as Record<string, unknown>)).toBe(false);
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
			'- 🧬 **position**:: Bridges quorum leases and client-side invalidation.',
			'- ✅ **contributions**:: Adaptive lease protocol; lock-free read path; YCSB-B evaluation.',
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

		it('extracts TL;DR, topic, position, contributions, novelty, and limitation from both wrapped and raw markdown', () => {
			const wrapped = JSON.stringify({ markdown_body: sampleMarkdown });
			expect(extractTakeawaySummary(wrapped)).toEqual({
				tldr: 'Lease-based cache coherence eliminates read locks at scale.',
				topic: 'Distributed storage and cache consistency.',
				position: 'Bridges quorum leases and client-side invalidation.',
				contributions:
					'Adaptive lease protocol; lock-free read path; YCSB-B evaluation.',
				novelty: 'Adaptive lease extension under skewed read-heavy workloads.',
				limitation: 'Tail latency spikes during lease revocation storms.',
			});
			expect(extractTakeawaySummary('# Empty Takeaway')).toEqual({
				tldr: '',
				topic: '',
				position: '',
				contributions: '',
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
				typeLabel: '',
				linkTitle: 'A - Systems - Caching - Lease Based Invalidation',
				linkPath: '',
				source: '',
				linkStatus: 'Proposed',
				storyline: 'Prevents stale reads without per-read coordination',
				answers: '',
				validation: '',
				evidence: '2.4x higher throughput on YCSB-B',
				brief: 'Short leases allow lock-free local reads while bounding staleness.',
				relatedPapers: 'nishtala2013, 10.1145/2485732.2485740',
				tags: ['systems/cache', 'distributed', 'consistency'],
			});
			expect(candidates[1]).toEqual({
				index: 2,
				heading: 'Plain Candidate Heading',
				typeLabel: '',
				linkTitle: 'Plain Candidate Heading',
				linkPath: '',
				source: '',
				linkStatus: 'Existing',
				storyline: '',
				answers: '',
				validation: '',
				evidence: '',
				brief: '',
				relatedPapers: '',
				tags: [],
			});
		});

		it('prioritizes Link bullet over bracketed TypeLabel headings, extracts path-qualified links, and falls back cleanly when Link is missing', () => {
			const synthesisTakeaway = [
				'## 💡 Candidate Atomic Zettels',
				'',
				'### Candidate 1 [Context & Problems]',
				'- **Link**: [[A - ML-Sys - Memory Modeling - Liveness determines peak tensor memory]]',
				'- **Source**: Paper',
				'- **Link Status**: Proposed — No confirmed match',
				'- **Storyline**: Problem',
				'- **Answers**: Why static graph planners overestimate activation memory',
				'- **Validation**: Exact liveness bounds verified across 12 transformer graphs',
				'- **Evidence**: 37% lower peak memory estimation error vs profile-free baseline',
				'- **Potential Tags**: #generatedTags/MemoryModeling, N/A, -',
				'- **Brief**: Operator liveness intervals dictate peak tensor footprint.',
				'- **Related Papers**: chen2016, jain2020',
				'',
				'### Candidate 2 [Core Insights]',
				'- **Source**: Synthesis',
				'- **Link Status**: Proposed — No confirmed match',
				'- **Storyline**: Insight',
				'- **Brief**: Missing Link bullet should never turn [Core Insights] into linkTitle.',
				'',
				'### Candidate 3 [Mechanisms]',
				'- **Link**: [[003-Permanent/Sub/A - GPU - Cache - Lease|A - GPU - Cache - Lease]]',
				'- **Link Status**: Existing — Matched in Vault',
				'- **Storyline**: Mechanism',
				'- **Validation**: Proven deadlock-free under warp divergence',
				'- **Potential Tags**: #generatedTags/GPUCache; #generatedTags/Leases',
				'',
				'### Candidate 4 [Trade-offs]',
				'- **Link**: 003-Permanent/Plain/A - GPU - Plain Path',
				'- **Link Status**: Existing',
			].join('\n');

			const parsed = parseTakeawayCandidates(synthesisTakeaway);
			expect(parsed).toHaveLength(4);

			// 1) Bracketed [Context & Problems] + - **Link**: [[...]] + Potential Tags + Source/Answers/Validation
			expect(parsed[0]).toEqual({
				index: 1,
				heading: '[Context & Problems]',
				typeLabel: 'Context & Problems',
				linkTitle:
					'A - ML-Sys - Memory Modeling - Liveness determines peak tensor memory',
				linkPath: '',
				source: 'Paper',
				linkStatus: 'Proposed — No confirmed match',
				storyline: 'Problem',
				answers: 'Why static graph planners overestimate activation memory',
				validation: 'Exact liveness bounds verified across 12 transformer graphs',
				evidence: '37% lower peak memory estimation error vs profile-free baseline',
				brief: 'Operator liveness intervals dictate peak tensor footprint.',
				relatedPapers: 'chen2016, jain2020',
				tags: ['generatedTags/MemoryModeling'],
			});
			expect(parsed[0].linkTitle).not.toBe('[Context & Problems]');

			// 2) Missing - **Link**: on ### Candidate 2 [Core Insights] -> clean fallback
			expect(parsed[1].typeLabel).toBe('Core Insights');
			expect(parsed[1].linkTitle).toBe('A - Concept - Candidate 2');
			expect(parsed[1].linkTitle).not.toBe('[Core Insights]');
			expect(parsed[1].linkPath).toBe('');

			// 3) Path-qualified wiki-link with alias
			expect(parsed[2].typeLabel).toBe('Mechanisms');
			expect(parsed[2].linkPath).toBe('003-Permanent/Sub/A - GPU - Cache - Lease');
			expect(parsed[2].linkTitle).toBe('A - GPU - Cache - Lease');
			expect(parsed[2].validation).toBe('Proven deadlock-free under warp divergence');
			expect(parsed[2].tags).toEqual([
				'generatedTags/GPUCache',
				'generatedTags/Leases',
			]);

			// 4) Plain-text path-qualified Link bullet without wiki brackets
			expect(parsed[3].typeLabel).toBe('Trade-offs');
			expect(parsed[3].linkPath).toBe('003-Permanent/Plain/A - GPU - Plain Path');
			expect(parsed[3].linkTitle).toBe('003-Permanent/Plain/A - GPU - Plain Path');
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
			paperWorkspace: { ...DEFAULT_PAPER_WORKSPACE },
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
			code: '',
			doi: 'doi: 10.1145/999999',
			'deep-report': 'https://gemini.google.com/share/deep-smith2024',
			'external-report': 'https://chatgpt.com/share/ext-smith2024',
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
		expect(frontmatters.get(litFile.path)?.code).toBe('https://github.com/smith/leases');
		expect(state!.doiUrl).toBe('https://doi.org/10.1145/999999');
		expect(state!.deepReportUrl).toBe('https://gemini.google.com/share/deep-smith2024');
		expect(state!.externalReportUrl).toBe('https://chatgpt.com/share/ext-smith2024');
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
		expect(state!.deepReportUrl).toBeNull();
		expect(state!.externalReportUrl).toBeNull();
		expect(state!.takeawayCandidates).toEqual([]);
	});

	it('createOrOpenReportFile returns existing files, creates empty markdown for report1/report2/takeaway, and serializes coreNote', async () => {
		const litFile = makeVaultFile('002-Literature/open2025.md');
		vaultFiles.set(litFile.path, litFile);
		frontmatters.set(litFile.path, { 'citation-key': 'open2025' });

		// 1. Creates empty '' .md files for report1, report2, and takeaway without reading clipboard
		const r1 = await service.createOrOpenReportFile('open2025', 'report1', litFile);
		expect(r1.path).toBe('002-Literature/102-Analysis Report/Deep Research-open2025.md');
		expect(vaultContents.get(r1.path)).toBe('');

		const r2 = await service.createOrOpenReportFile('open2025', 'report2', litFile);
		expect(r2.path).toBe(
			'002-Literature/103-External Analysis Report/External Research-open2025.md'
		);
		expect(vaultContents.get(r2.path)).toBe('');

		const tw = await service.createOrOpenReportFile('open2025', 'takeaway');
		expect(tw.path).toBe('002-Literature/101-Takeaways/Takeaway-open2025.md');
		expect(vaultContents.get(tw.path)).toBe('');

		// 2. Returns existing TFile without overwriting its content
		vaultContents.set(r1.path, '# Populated Deep Report');
		(app.vault.create as jest.Mock).mockClear();
		const existingR1 = await service.createOrOpenReportFile('open2025', 'report1', litFile);
		expect(existingR1).toBe(r1);
		expect(vaultContents.get(r1.path)).toBe('# Populated Deep Report');
		expect(app.vault.create).not.toHaveBeenCalled();

		// 3. Creates serialized Core Note when missing
		const core = await service.createOrOpenReportFile('open2025', 'coreNote', litFile);
		expect(core.path).toBe('002-Literature/104-Paper Notes/open2025.md');
		expect(parseCoreNoteContent(vaultContents.get(core.path)!)).toEqual({
			citekey: 'open2025',
			source: '[[002-Literature/open2025|open2025]]',
			projects: [],
			linkedNotes: [],
			body: '',
		});
	});

	it('rewriteCandidateLinkInTakeaway handles missing files, raw Markdown updates/insertions with word boundaries, and JSON envelopes', async () => {
		// 1. Missing takeaway file -> false
		await expect(
			service.rewriteCandidateLinkInTakeaway(
				'missing2025',
				1,
				'[[003-Permanent/A - Target|A - Target]]'
			)
		).resolves.toBe(false);

		// 2. Raw Markdown with existing - **Link**: and - **Link Status**:
		const paths = resolvePaperPaths(settings.paperWorkspace, 'rw2025');
		const takeawayFile = makeVaultFile(paths.takeaway);
		vaultFiles.set(takeawayFile.path, takeawayFile);
		vaultContents.set(
			takeawayFile.path,
			[
				'## 💡 Candidate Atomic Zettels',
				'',
				'### Candidate 1 [Context & Problems]',
				'- **Link**: [[A - Old - Proposed - Title]]',
				'- **Link Status**: Proposed — No confirmed match',
				'- **Storyline**: Problem',
				'',
				'### Candidate 2 [Core Insights]',
				'- **Link**: [[A - Unchanged - Second - Note]]',
				'- **Link Status**: Proposed',
			].join('\n')
		);

		// Non-existent candidate index -> false
		await expect(
			service.rewriteCandidateLinkInTakeaway('rw2025', 99, '[[003-Permanent/X|X]]')
		).resolves.toBe(false);

		await expect(
			service.rewriteCandidateLinkInTakeaway(
				'rw2025',
				1,
				'[[003-Permanent/A - Canonical - Vault - Zettel|A - Canonical - Vault - Zettel]]'
			)
		).resolves.toBe(true);

		const updatedRaw = vaultContents.get(takeawayFile.path)!;
		expect(updatedRaw).toContain(
			'### Candidate 1 [Context & Problems]\n- **Link**: [[003-Permanent/A - Canonical - Vault - Zettel|A - Canonical - Vault - Zettel]]'
		);
		expect(updatedRaw).toContain('- **Link Status**: Existing — Linked in Vault');
		expect(updatedRaw).toContain('- **Link**: [[A - Unchanged - Second - Note]]');
		const reparsedAfterRaw = parseTakeawayCandidates(updatedRaw);
		expect(reparsedAfterRaw[0].typeLabel).toBe('Context & Problems');
		expect(reparsedAfterRaw[0].linkPath).toBe(
			'003-Permanent/A - Canonical - Vault - Zettel'
		);
		expect(reparsedAfterRaw[0].linkTitle).toBe('A - Canonical - Vault - Zettel');
		expect(reparsedAfterRaw[0].linkStatus).toBe('Existing — Linked in Vault');

		// 3. Raw Markdown missing - **Link**: and ensuring Candidate 1 does NOT match Candidate 10
		vaultContents.set(
			takeawayFile.path,
			[
				'### Candidate 10 [Extra]',
				'- **Link**: [[A - Ten - Untouched]]',
				'- **Link Status**: Proposed',
				'',
				'### Candidate 1 [Core Insights]',
				'- **Source**: Synthesis',
				'- **Link Status**: Proposed — No confirmed match',
				'- **Brief**: Needs inserted Link bullet.',
			].join('\n')
		);

		await expect(
			service.rewriteCandidateLinkInTakeaway(
				'rw2025',
				1,
				'[[003-Permanent/A - Inserted - Zettel|A - Inserted - Zettel]]'
			)
		).resolves.toBe(true);

		const afterInsert = vaultContents.get(takeawayFile.path)!;
		expect(afterInsert).toContain(
			'### Candidate 10 [Extra]\n- **Link**: [[A - Ten - Untouched]]\n- **Link Status**: Proposed'
		);
		expect(afterInsert).toContain(
			'### Candidate 1 [Core Insights]\n- **Link**: [[003-Permanent/A - Inserted - Zettel|A - Inserted - Zettel]]\n- **Source**: Synthesis\n- **Link Status**: Existing — Linked in Vault'
		);

		// 4. JSON { markdown_body } envelope rewrite preserves outer metadata
		const jsonEnvelope = JSON.stringify(
			{
				filename_suggestion: 'Takeaway-rw2025',
				metadata: { citekey: 'rw2025', title: 'Rewrite Test' },
				markdown_body: [
					'### Candidate 2 [Mechanisms]',
					'- **Link**: [[A - Draft - Mechanism]]',
					'- **Link Status**: Proposed — No confirmed match',
					'## 📊 Research Profile',
					'- 💊 **TL;DR**:: Summary.',
				].join('\n'),
			},
			null,
			2
		);
		vaultContents.set(takeawayFile.path, jsonEnvelope);

		await expect(
			service.rewriteCandidateLinkInTakeaway(
				'rw2025',
				2,
				'[[003-Permanent/Sub/A - Reused - Mechanism|A - Reused - Mechanism]]'
			)
		).resolves.toBe(true);

		const parsedAfterJson = JSON.parse(vaultContents.get(takeawayFile.path)!) as Record<
			string,
			unknown
		>;
		expect(parsedAfterJson.filename_suggestion).toBe('Takeaway-rw2025');
		expect(parsedAfterJson.metadata).toEqual({ citekey: 'rw2025', title: 'Rewrite Test' });
		expect(parsedAfterJson.markdown_body).toBe(
			[
				'### Candidate 2 [Mechanisms]',
				'- **Link**: [[003-Permanent/Sub/A - Reused - Mechanism|A - Reused - Mechanism]]',
				'- **Link Status**: Existing — Linked in Vault',
				'## 📊 Research Profile',
				'- 💊 **TL;DR**:: Summary.',
			].join('\n')
		);
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

describe('ZoteroConnectorService template management and interactive import', () => {
	let app: App;
	let settings: MyPluginSettings;
	let connector: ZoteroConnectorService;
	let vaultFiles: Map<string, TFile>;
	let vaultContents: Map<string, string>;

	beforeEach(() => {
		(Notice as unknown as jest.Mock).mockClear();
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

	it('triggerInteractiveImport executes exact zdc-exp-<format> command when registered', async () => {
		const runImport = jest.fn();
		((app as any).plugins.getPlugin as jest.Mock).mockReturnValue({
			settings: { exportFormats: [{ name: 'Literature' }] },
			runImport,
		});
		const executeCommandById = jest.fn().mockReturnValue(true);
		(app as any).commands = {
			commands: {
				'obsidian-zotero-desktop-connector:zdc-exp-Other': {},
				'obsidian-zotero-desktop-connector:zdc-exp-Literature': {},
			},
			executeCommandById,
		};

		await expect(connector.triggerInteractiveImport()).resolves.toBe(true);
		expect(executeCommandById).toHaveBeenCalledTimes(1);
		expect(executeCommandById).toHaveBeenCalledWith(
			'obsidian-zotero-desktop-connector:zdc-exp-Literature'
		);
		expect(runImport).not.toHaveBeenCalled();
		expect(Notice).not.toHaveBeenCalled();
	});

	it('triggerInteractiveImport falls back to first zdc-exp-* command when exact format command is absent', async () => {
		const runImport = jest.fn();
		((app as any).plugins.getPlugin as jest.Mock).mockReturnValue({
			settings: { exportFormats: [{ name: 'RenamedFormat' }] },
			runImport,
		});
		const executeCommandById = jest.fn().mockReturnValue(true);
		(app as any).commands = {
			commands: {
				'editor:toggle-bold': {},
				'obsidian-zotero-desktop-connector:zdc-exp-Default': {},
			},
			executeCommandById,
		};

		await expect(connector.triggerInteractiveImport()).resolves.toBe(true);
		expect(executeCommandById).toHaveBeenCalledTimes(1);
		expect(executeCommandById).toHaveBeenCalledWith(
			'obsidian-zotero-desktop-connector:zdc-exp-Default'
		);
		expect(runImport).not.toHaveBeenCalled();
		expect(Notice).not.toHaveBeenCalled();
	});

	it('triggerInteractiveImport falls back to plugin.runImport(fmt.name) without citekey when no zdc-exp command exists', async () => {
		const runImport = jest.fn().mockResolvedValue(undefined);
		((app as any).plugins.getPlugin as jest.Mock).mockReturnValue({
			settings: { exportFormats: [{ name: 'Markdown' }] },
			runImport,
		});
		(app as any).commands = {
			commands: { 'editor:open-search': {} },
			executeCommandById: jest.fn(),
		};

		await expect(connector.triggerInteractiveImport()).resolves.toBe(true);
		expect(runImport).toHaveBeenCalledTimes(1);
		expect(runImport).toHaveBeenCalledWith('Markdown');
		expect(Notice).not.toHaveBeenCalled();
	});

	it('triggerInteractiveImport shows Notice and returns false when connector plugin is missing or unconfigured', async () => {
		((app as any).plugins.getPlugin as jest.Mock).mockReturnValue(null);
		(app as any).commands = undefined;

		await expect(connector.triggerInteractiveImport()).resolves.toBe(false);
		expect(Notice).toHaveBeenCalledWith(
			'Obsidian Zotero Desktop Connector plugin not found or configured.'
		);
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
