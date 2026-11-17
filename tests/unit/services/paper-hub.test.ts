import yaml from 'js-yaml';
import {
	DEFAULT_ATOMIC_NOTE_TEMPLATE,
	DEFAULT_CORE_NOTE_TEMPLATE,
	DEFAULT_PAPER_WORKSPACE,
	DEFAULT_PROMPTS,
	DEFAULT_REPORT1_NOTE_TEMPLATE,
	DEFAULT_REPORT1_PROMPT,
	DEFAULT_REPORT2_NOTE_TEMPLATE,
	DEFAULT_REPORT2_PROMPT,
	DEFAULT_SETTINGS,
	DEFAULT_SYNTHESIZE_PROMPT,
	DEFAULT_TAKEAWAY_NOTE_TEMPLATE,
	DEFAULT_ZOTERO_TEMPLATE,
	MyPluginSettings,
	PromptTemplateEntry,
} from '../../../src/types';
import {
	CoreNoteData,
	extractCodeUrlFromReport,
	extractTakeawaySummary,
	PaperHubService,
	parseCoreNoteContent,
	parseTakeawayCandidates,
	renderNoteTemplateString,
	resolveCitekeyTemplate,
	resolvePaperPaths,
	serializeCoreNoteContent,
	unwrapTakeawayMarkdown,
} from '../../../src/services/paper-hub';
import { resetObsidianMocks } from '../../__mocks__/obsidian';
import { createTestApp, makeVaultFile, TestAppHarness } from '../../fixtures/vault';

describe('paper-hub pure helpers', () => {
	describe('resolveCitekeyTemplate', () => {
		it('replaces {{citekey}}, {{citation-key}}, and ${citekey} placeholders, strips leading @ to prevent @@ doubling, and normalizes slashes', () => {
			expect(
				resolveCitekeyTemplate('002-Literature\\{{citekey}}.md', ' smith2024 ')
			).toBe('002-Literature/smith2024.md');
			expect(
				resolveCitekeyTemplate(
					'/002-Literature/{{ citation-key }}/note-${citekey}.md',
					'lecun1998'
				)
			).toBe('002-Literature/lecun1998/note-lecun1998.md');
			expect(resolveCitekeyTemplate('./001-Fleeting', 'lecun1998')).toBe(
				'001-Fleeting'
			);
			expect(
				resolveCitekeyTemplate(
					'002-Literature/100-Zotero/@{{citekey}}.md',
					' @linDrGPUMGuidingMemory2023 '
				)
			).toBe('002-Literature/100-Zotero/@linDrGPUMGuidingMemory2023.md');
			expect(
				resolveCitekeyTemplate(
					'002-Literature/100-Zotero/@{{citekey}}.md',
					'linDrGPUMGuidingMemory2023'
				)
			).toBe('002-Literature/100-Zotero/@linDrGPUMGuidingMemory2023.md');
		});
	});

	describe('DEFAULT_ZOTERO_TEMPLATE Nunjucks & YAML contracts', () => {
		function simulateNunjucksAuthorsBlock(
			template: string,
			authorsValue: string
		): string {
			const match = template.match(
				/authors:[\s\S]*?create: \{\{date \| format\("YYYY-MM-DD"\)\}\}/
			);
			if (!match) {
				throw new Error(
					'Could not locate authors..create block in DEFAULT_ZOTERO_TEMPLATE'
				);
			}
			const rawBlock = match[0];

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
			rendered += parts[8].replace(
				'{{date | format("YYYY-MM-DD")}}',
				'"2024-05-01"'
			);
			return rendered;
		}

		it('omits trailing -%} in authors loop tags and renders valid YAML list or null with create on its own line', () => {
			const authorsSectionMatch = DEFAULT_ZOTERO_TEMPLATE.match(
				/authors:[\s\S]*?create: \{\{date \| format\("YYYY-MM-DD"\)\}\}/
			);
			expect(authorsSectionMatch).not.toBeNull();
			expect(authorsSectionMatch![0]).not.toContain('-%}');
			expect(DEFAULT_ZOTERO_TEMPLATE).not.toMatch(
				/\{%-?\s*for\s+author[^%]*-%\}/
			);
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain('{%- if authors %}');
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain(
				'{%- for author in authors.split(",") %}'
			);
			expect(DEFAULT_ZOTERO_TEMPLATE).toContain(
				'{%- endfor %}\n{%- endif %}\ncreate:'
			);

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

			const renderedEmptyAuthors = simulateNunjucksAuthorsBlock(
				DEFAULT_ZOTERO_TEMPLATE,
				''
			);
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
		it('resolves all five vault-relative workspace paths without S3 fields and strips leading @ without @@ doubling', () => {
			const resolved = resolvePaperPaths(
				DEFAULT_PAPER_WORKSPACE,
				' vaswani2017 '
			);

			expect(resolved).toEqual({
				citekey: 'vaswani2017',
				literatureNote: '002-Literature/vaswani2017.md',
				report1:
					'002-Literature/102-Analysis Report/Deep Research-vaswani2017.md',
				report2:
					'002-Literature/103-External Analysis Report/External Research-vaswani2017.md',
				takeaway: '002-Literature/101-Takeaways/Takeaway-vaswani2017.md',
				coreNote: '002-Literature/104-Paper Notes/vaswani2017.md',
			});
			expect('s3' in (resolved as unknown as Record<string, unknown>)).toBe(
				false
			);

			const atWorkspace = {
				...DEFAULT_PAPER_WORKSPACE,
				literatureNotePath: '002-Literature/100-Zotero/@{{citekey}}.md',
			};
			const resolvedAt = resolvePaperPaths(
				atWorkspace,
				' @linDrGPUMGuidingMemory2023 '
			);
			expect(resolvedAt).toEqual({
				citekey: 'linDrGPUMGuidingMemory2023',
				literatureNote:
					'002-Literature/100-Zotero/@linDrGPUMGuidingMemory2023.md',
				report1:
					'002-Literature/102-Analysis Report/Deep Research-linDrGPUMGuidingMemory2023.md',
				report2:
					'002-Literature/103-External Analysis Report/External Research-linDrGPUMGuidingMemory2023.md',
				takeaway:
					'002-Literature/101-Takeaways/Takeaway-linDrGPUMGuidingMemory2023.md',
				coreNote:
					'002-Literature/104-Paper Notes/linDrGPUMGuidingMemory2023.md',
			});
			expect(resolvedAt.literatureNote).not.toContain('@@');
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
			expect(extractCodeUrlFromReport(md)).toBe(
				'https://github.com/org/awesome-paper'
			);
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
			expect(extractCodeUrlFromReport(mdWithFallback)).toBe(
				'http://gitlab.com/lab/repro'
			);
		});

		it('ignores null, N/A, placeholder tokens, non-http schemes, and empty input', () => {
			expect(extractCodeUrlFromReport('')).toBeNull();
			expect(
				extractCodeUrlFromReport('```json\n{"code_url": "N/A"}\n```')
			).toBeNull();
			expect(
				extractCodeUrlFromReport('```json\n{"code_url": "null"}\n```')
			).toBeNull();
			expect(
				extractCodeUrlFromReport('```json\n{"code_url": "unknown"}\n```')
			).toBeNull();
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
			expect(unwrapTakeawayMarkdown('{"other_key": 42}')).toBe(
				'{"other_key": 42}'
			);
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
				heading:
					'[[A - Systems - Caching - Lease Based Invalidation|Lease Invalidation]]',
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
				validation:
					'Exact liveness bounds verified across 12 transformer graphs',
				evidence:
					'37% lower peak memory estimation error vs profile-free baseline',
				brief: 'Operator liveness intervals dictate peak tensor footprint.',
				relatedPapers: 'chen2016, jain2020',
				tags: ['generatedTags/MemoryModeling'],
			});

			expect(parsed[1].typeLabel).toBe('Core Insights');
			expect(parsed[1].linkTitle).toBe('A - Concept - Candidate 2');
			expect(parsed[1].linkPath).toBe('');

			expect(parsed[2].typeLabel).toBe('Mechanisms');
			expect(parsed[2].linkPath).toBe(
				'003-Permanent/Sub/A - GPU - Cache - Lease'
			);
			expect(parsed[2].linkTitle).toBe('A - GPU - Cache - Lease');
			expect(parsed[2].validation).toBe(
				'Proven deadlock-free under warp divergence'
			);
			expect(parsed[2].tags).toEqual([
				'generatedTags/GPUCache',
				'generatedTags/Leases',
			]);

			expect(parsed[3].typeLabel).toBe('Trade-offs');
			expect(parsed[3].linkPath).toBe('003-Permanent/Plain/A - GPU - Plain Path');
			expect(parsed[3].linkTitle).toBe(
				'003-Permanent/Plain/A - GPU - Plain Path'
			);
		});

		it('completes extractTakeawaySummary and parseTakeawayCandidates in linear time on adversarial long whitespace', () => {
			const summaryAdversarial = [
				'- 💊 **TL;DR**' + ' '.repeat(50000) + 'X',
				' '.repeat(50000) + '::' + ' '.repeat(50000),
				'- 💊 **TL;DR**' + ' '.repeat(50000) + ':: Fast linear summary.',
			].join('\n');

			const summaryStart = performance.now();
			const summary = extractTakeawaySummary(summaryAdversarial);
			const summaryElapsed = performance.now() - summaryStart;
			expect(summary.tldr).toBe('Fast linear summary.');
			expect(summaryElapsed).toBeLessThan(100);

			const candidatesAdversarial = [
				'### Candidate 1 ' + ' '.repeat(50000),
				'- **Brief**:' + ' '.repeat(50000) + 'Linear candidate brief.',
				'### Candidate 2 ' + '-'.repeat(50000),
				'- **Link Status**: Proposed',
			].join('\n');

			const candStart = performance.now();
			const candidates = parseTakeawayCandidates(candidatesAdversarial);
			const candElapsed = performance.now() - candStart;
			expect(candidates).toHaveLength(2);
			expect(candidates[0].linkTitle).toBe('A - Concept - Candidate 1');
			expect(candidates[0].brief).toBe('Linear candidate brief.');
			expect(candidates[1].linkTitle).toBe('A - Concept - Candidate 2');
			expect(candElapsed).toBeLessThan(100);
		});
	});

	describe('workspace, template, and prompt defaults', () => {
		it('defines templatesFolder, report/takeaway labels, and strictly enforces the 4-type vault taxonomy across all built-in templates', () => {
			expect(DEFAULT_PAPER_WORKSPACE.templatesFolder).toBe('900-Templates');
			expect(DEFAULT_PAPER_WORKSPACE.report1Label).toBe('Deep Report');
			expect(DEFAULT_PAPER_WORKSPACE.report2Label).toBe('External Report');
			expect(DEFAULT_PAPER_WORKSPACE.takeawayLabel).toBe('Takeaway');
			expect(DEFAULT_SETTINGS.zoteroTemplate.vaultPath).toBe(
				'900-Templates/zotero-note-template.md'
			);

			const templateEntries = DEFAULT_PROMPTS.filter(
				(p) => p.kind === 'template'
			);
			const promptEntries = DEFAULT_PROMPTS.filter((p) => p.kind === 'prompt');
			expect(templateEntries.map((p) => p.id)).toEqual([
				'tpl-report1',
				'tpl-report2',
				'tpl-takeaway',
				'tpl-core-note',
				'tpl-atomic-note',
			]);
			expect(promptEntries.map((p) => p.id)).toEqual([
				'synthesize',
				'report1',
				'report2',
			]);

			const allowedVaultTypes = new Set([
				'fleeting',
				'literature',
				'atom',
				'permanent',
			]);
			const builtInTemplates: Array<{
				name: string;
				content: string;
				expectedType: string;
			}> = [
				{
					name: 'DEFAULT_ZOTERO_TEMPLATE',
					content: DEFAULT_ZOTERO_TEMPLATE,
					expectedType: 'literature',
				},
				{
					name: 'DEFAULT_REPORT1_NOTE_TEMPLATE',
					content: DEFAULT_REPORT1_NOTE_TEMPLATE,
					expectedType: 'literature',
				},
				{
					name: 'DEFAULT_REPORT2_NOTE_TEMPLATE',
					content: DEFAULT_REPORT2_NOTE_TEMPLATE,
					expectedType: 'literature',
				},
				{
					name: 'DEFAULT_TAKEAWAY_NOTE_TEMPLATE',
					content: DEFAULT_TAKEAWAY_NOTE_TEMPLATE,
					expectedType: 'literature',
				},
				{
					name: 'DEFAULT_CORE_NOTE_TEMPLATE',
					content: DEFAULT_CORE_NOTE_TEMPLATE,
					expectedType: 'literature',
				},
				{
					name: 'DEFAULT_ATOMIC_NOTE_TEMPLATE',
					content: DEFAULT_ATOMIC_NOTE_TEMPLATE,
					expectedType: 'permanent',
				},
				...templateEntries.map((entry) => ({
					name: `DEFAULT_PROMPTS[${entry.id}]`,
					content: entry.content,
					expectedType:
						entry.id === 'tpl-atomic-note' ? 'permanent' : 'literature',
				})),
			];

			for (const tpl of builtInTemplates) {
				const typeMatches = Array.from(
					tpl.content.matchAll(/^type:\s*(.+)$/gm)
				).map((m) => m[1].trim());
				expect(typeMatches).toEqual([tpl.expectedType]);
				for (const t of typeMatches) {
					expect(allowedVaultTypes.has(t)).toBe(true);
				}
			}

			expect(DEFAULT_REPORT1_NOTE_TEMPLATE).toContain('  - source/🤖AI');
			expect(DEFAULT_REPORT1_NOTE_TEMPLATE).toContain(
				'  - "[[{{source_name}}]]"'
			);
			expect(DEFAULT_REPORT2_NOTE_TEMPLATE).toContain('  - source/🤖AI');
			expect(DEFAULT_REPORT2_NOTE_TEMPLATE).toContain(
				'  - "[[{{source_name}}]]"'
			);
			expect(DEFAULT_TAKEAWAY_NOTE_TEMPLATE).toContain('  - source/🤖AI');
			expect(DEFAULT_TAKEAWAY_NOTE_TEMPLATE).toContain(
				'  - "[[{{report1_name}}]]"'
			);
			expect(DEFAULT_TAKEAWAY_NOTE_TEMPLATE).toContain(
				'  - "[[{{report2_name}}]]"'
			);
			expect(DEFAULT_TAKEAWAY_NOTE_TEMPLATE).toContain('venue: "{{venue}}"');
			expect(DEFAULT_TAKEAWAY_NOTE_TEMPLATE).not.toContain('venus:');
			expect(DEFAULT_CORE_NOTE_TEMPLATE).toContain(
				'source: "[[{{source_name}}|{{citekey}}]]"'
			);
			expect(DEFAULT_ATOMIC_NOTE_TEMPLATE).toContain(
				'  - "[[{{source_name}}|{{citekey}}]]"'
			);
		});
	});

	describe('renderNoteTemplateString', () => {
		it('substitutes all template placeholders, escapes YAML scalars, formats empty vs multi-author YAML lists, and preserves literal $ sequences', () => {
			const renderedR1 = renderNoteTemplateString(DEFAULT_REPORT1_NOTE_TEMPLATE, {
				citekey: '  @vaswani2017  ',
				id: ' custom_id-01!@# ',
				sourcePath: '002-Literature/100-Zotero/@vaswani2017.md',
				date: '2026-04-15',
			});

			const r1FmMatch = renderedR1.match(/^---\n([\s\S]*?)\n---/);
			expect(r1FmMatch).not.toBeNull();
			expect(yaml.load(r1FmMatch![1])).toEqual({
				id: 'custom_id-01',
				create: new Date('2026-04-15T00:00:00.000Z'),
				title: 'Deep Research-vaswani2017',
				type: 'literature',
				url: '',
				tags: ['source/🤖AI'],
				aliases: ['custom_id-01'],
				sources: ['[[@vaswani2017]]'],
				'need-attention': false,
				notion: '',
			});

			// Rich Takeaway rendering with multi-author YAML list, escaped quotes/backslashes, and $ literal safety
			const renderedTakeawayRich = renderNoteTemplateString(
				DEFAULT_TAKEAWAY_NOTE_TEMPLATE,
				{
					citekey: '@linDrGPUMGuidingMemory2023',
					sourceName: '@linDrGPUMGuidingMemory2023.md',
					report1Name: 'Deep Research-linDrGPUMGuidingMemory2023.md',
					report2Name: 'External Research-linDrGPUMGuidingMemory2023.md',
					date: '2026-05-10',
					doiOrUrl: 'https://doi.org/10.1145/12345?cost=$&\\test',
					shortName: 'DrGPUM "Memory" $1 \\Path',
					authors: [
						'  Alice "A." Smith  ',
						'   ',
						"Bob C:\\Lab\\ $& $` $' $$",
					],
					venue: 'OSDI "23" \\ Proceedings $&',
					paperType: 'conferencePaper "$1"',
				}
			);
			const twRichFmMatch = renderedTakeawayRich.match(/^---\n([\s\S]*?)\n---/);
			expect(twRichFmMatch).not.toBeNull();
			const parsedTwRich = yaml.load(twRichFmMatch![1]) as Record<
				string,
				unknown
			>;
			expect(parsedTwRich.id).toMatch(/^[a-z0-9]{16}$/);
			expect(parsedTwRich).toEqual({
				id: parsedTwRich.id,
				create: new Date('2026-05-10T00:00:00.000Z'),
				title: 'Takeaway-linDrGPUMGuidingMemory2023',
				type: 'literature',
				url: 'https://doi.org/10.1145/12345?cost=$&\\test',
				tags: ['source/🤖AI'],
				aliases: [parsedTwRich.id],
				sources: [
					'[[Deep Research-linDrGPUMGuidingMemory2023]]',
					'[[External Research-linDrGPUMGuidingMemory2023]]',
				],
				'need-attention': true,
				shortName: 'DrGPUM "Memory" $1 \\Path',
				author: ['Alice "A." Smith', "Bob C:\\Lab\\ $& $` $' $$"],
				venue: 'OSDI "23" \\ Proceedings $&',
				notion: '',
				'paper-type': 'conferencePaper "$1"',
				citekey: 'linDrGPUMGuidingMemory2023',
			});

			// Empty authors list renders inline [] and sanitized-to-empty id falls back to generated 16-char id
			const renderedTakeawayEmpty = renderNoteTemplateString(
				DEFAULT_TAKEAWAY_NOTE_TEMPLATE,
				{
					citekey: 'bare2026',
					id: '   ***   ',
					date: '2026-05-11',
					authors: ['   '],
				}
			);
			expect(renderedTakeawayEmpty).toContain('author: []');
			const parsedTwEmpty = yaml.load(
				renderedTakeawayEmpty.match(/^---\n([\s\S]*?)\n---/)![1]
			) as Record<string, unknown>;
			expect(parsedTwEmpty.id).toMatch(/^[a-z0-9]{16}$/);
			expect(parsedTwEmpty.author).toEqual([]);
			expect(parsedTwEmpty.sources).toEqual([
				'[[Deep Research-bare2026]]',
				'[[External Research-bare2026]]',
			]);
			expect(parsedTwEmpty.venue).toBe('');
			expect(parsedTwEmpty.url).toBe('');
			expect(parsedTwEmpty.shortName).toBe('');
			expect(parsedTwEmpty['paper-type']).toBe('');

			for (const singleLineTitle of [
				'Sorting in $O(n\\log n)$ with \\alpha-trees',
				'Trailing Backslash Path C:\\Users\\Alice\\',
				'Mixed "Quotes" and \\"Escaped Quotes\\" and $& $1 $$',
			]) {
				const yamlLine = renderNoteTemplateString('title: "{{title}}"', {
					citekey: 'test2026',
					title: singleLineTitle,
				});
				expect(yaml.load(yamlLine)).toEqual({ title: singleLineTitle });
			}

			const atomicRendered = renderNoteTemplateString(
				'{{ citekey }} | {{ date }} | {{ source_name }} | # {{ atomic_title }}',
				{
					citekey: '@smith2024',
					sourcePath: '002-Literature/100-Zotero/@smith2024.md',
					atomicTitle: '  A - Systems - Leases  ',
				}
			);
			expect(atomicRendered).toMatch(
				/^smith2024 \| \d{4}-\d{2}-\d{2} \| @smith2024 \| # A - Systems - Leases$/
			);

			const fallbackRendered = renderNoteTemplateString(
				'title="{{title}}" src="[[{{source_path}}]]" name="[[{{source_name}}]]" atom="{{atomic_title}}"',
				{
					citekey: 'bare2025',
					title: '   ',
					sourcePath: '   ',
					sourceName: '   ',
				}
			);
			expect(fallbackRendered).toBe(
				'title="bare2025" src="[[bare2025]]" name="[[bare2025]]" atom=""'
			);
		});
	});

	describe('parseCoreNoteContent and serializeCoreNoteContent', () => {
		it('defaults serialized type to literature, omits both literature and legacy paper-note from extraFrontmatter, and round-trips CoreNoteData', () => {
			const input: CoreNoteData = {
				citekey: 'smith2024',
				source: '[[smith2024|smith2024]]',
				projects: ['[[Projects/CacheProj|CacheProj]]'],
				linkedNotes: ['[[A - Systems - Caching - Lease Based Invalidation]]'],
				body: 'Core claim: bounded leases outperform quorum reads.\n\nSecond paragraph.',
			};
			const serialized = serializeCoreNoteContent(input);
			expect(serialized).toContain('type: literature\n');
			const parsed = parseCoreNoteContent(serialized);
			expect(parsed).toEqual(input);
			expect(parsed.extraFrontmatter).toBeUndefined();

			const legacyPaperNoteRaw = [
				'---',
				'citation-key: legacy2023',
				'type: paper-note',
				'source: "[[legacy2023|legacy2023]]"',
				'projects: []',
				'linked-notes: []',
				'---',
				'',
				'Legacy body.',
			].join('\n');
			const parsedLegacy = parseCoreNoteContent(legacyPaperNoteRaw);
			expect(parsedLegacy.extraFrontmatter).toBeUndefined();
			expect(serializeCoreNoteContent(parsedLegacy)).toContain(
				'type: literature\n'
			);
		});

		it('preserves extraFrontmatter keys (create, tags, title, custom type, nested dates) across parse and serialize', () => {
			const rawWithExtras = [
				'---',
				'citation-key: extra2026',
				'type: custom-paper-note',
				'title: "Core - Extra Note"',
				'source: "[[002-Literature/extra2026|extra2026]]"',
				'create: 2026-05-01',
				'reviewMeta:',
				'  reviewedOn: 2026-05-02',
				'  milestones:',
				'    - 2026-05-03',
				'projects:',
				'  - "[[ProjX]]"',
				'linked-notes:',
				'  - "[[A - Extra - Claim]]"',
				'tags:',
				'  - type/paper-note',
				'  - domain/systems',
				'---',
				'',
				'Preserved body text.',
			].join('\n');

			const parsed = parseCoreNoteContent(rawWithExtras);
			expect(parsed).toEqual({
				citekey: 'extra2026',
				source: '[[002-Literature/extra2026|extra2026]]',
				projects: ['[[ProjX]]'],
				linkedNotes: ['[[A - Extra - Claim]]'],
				body: 'Preserved body text.',
				extraFrontmatter: {
					type: 'custom-paper-note',
					title: 'Core - Extra Note',
					create: '2026-05-01',
					reviewMeta: {
						reviewedOn: '2026-05-02',
						milestones: ['2026-05-03'],
					},
					tags: ['type/paper-note', 'domain/systems'],
				},
			});

			const reserialized = serializeCoreNoteContent(parsed);
			expect(reserialized.indexOf('projects:')).toBeLessThan(
				reserialized.indexOf('tags:')
			);
			expect(parseCoreNoteContent(reserialized)).toEqual(parsed);
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
	let harness: TestAppHarness;
	let settings: MyPluginSettings;
	let service: PaperHubService;

	beforeEach(() => {
		resetObsidianMocks();
		harness = createTestApp();
		settings = {
			...DEFAULT_SETTINGS,
			paperWorkspace: { ...DEFAULT_PAPER_WORKSPACE },
			prompts: DEFAULT_SETTINGS.prompts.map((p) => ({ ...p })),
		};
		service = new PaperHubService(harness.app, () => settings);
	});

	it('getCitekeyForFile resolves custom key, citation-key, citekey, and zotero-key fallbacks, or returns null when absent', () => {
		const f1 = harness.addFile('002-Literature/a.md');
		expect(service.getCitekeyForFile(f1)).toBeNull();

		harness.setFrontmatter(f1.path, { citekey: '  citekey2026  ' });
		expect(service.getCitekeyForFile(f1)).toBe('citekey2026');

		harness.setFrontmatter(f1.path, { 'zotero-key': '  zot2024  ' });
		expect(service.getCitekeyForFile(f1)).toBe('zot2024');

		settings.citationKeyName = 'custom-cite-id';
		harness.setFrontmatter(f1.path, { 'custom-cite-id': '  custom2025  ' });
		expect(service.getCitekeyForFile(f1)).toBe('custom2025');

		harness.setFrontmatter(f1.path, { 'citation-key': '   ' });
		expect(service.getCitekeyForFile(f1)).toBeNull();
	});

	it('ensureParentFolder creates nested folders, ignores already-exists race, and rethrows fatal errors', async () => {
		harness.mockApp.vault.createFolder
			.mockResolvedValueOnce(harness.folders.get('')!)
			.mockRejectedValueOnce(new Error('Folder already exists'));

		await expect(
			service.ensureParentFolder('002-Literature/101-Takeaways/Takeaway-k.md')
		).resolves.toBeUndefined();
		expect(harness.mockApp.vault.createFolder).toHaveBeenCalledWith(
			'002-Literature'
		);
		expect(harness.mockApp.vault.createFolder).toHaveBeenCalledWith(
			'002-Literature/101-Takeaways'
		);

		harness.mockApp.vault.createFolder.mockRejectedValueOnce(
			new Error('Permission denied')
		);
		await expect(service.ensureParentFolder('009-Locked/note.md')).rejects.toThrow(
			'Permission denied'
		);
	});

	it('getPaperState aggregates companion files, fleeting thoughts, merged projects, and fallback code/DOI URLs', async () => {
		const litFile = harness.addFile('002-Literature/smith2024.md', '', {
			'citation-key': 'smith2024',
			projects: ['[[ProjA]]'],
			code: '',
			doi: 'doi: 10.1145/999999',
			'deep-report': 'https://gemini.google.com/share/deep-smith2024',
			'external-report': 'https://chatgpt.com/share/ext-smith2024',
		});

		const paths = resolvePaperPaths(settings.paperWorkspace, 'smith2024');
		harness.addFile(
			paths.coreNote,
			serializeCoreNoteContent({
				citekey: 'smith2024',
				source: '[[002-Literature/smith2024|smith2024]]',
				projects: ['[[ProjA]]', '[[ProjB]]'],
				linkedNotes: ['[[A - Sys - Cache - Lease]]'],
				body: 'My synthesis.',
			})
		);
		harness.addFile(
			paths.takeaway,
			[
				'### Candidate 1: [[A - Sys - Cache - Lease]]',
				'- **Brief**: Atomic brief.',
				'## 📊 Research Profile',
				'- 💊 **TL;DR**:: Fast cache leases.',
			].join('\n')
		);
		const report2File = harness.addFile(
			paths.report2,
			'```json\n{"code_url": "https://github.com/smith/leases"}\n```'
		);

		const fl1 = harness.addFile(
			'001-Fleeting/hl-1.md',
			'## Thoughts\nComment at page 3\nKey insight on lease renewal.\n## Quote\ntext',
			{ 'citation-key': '@SMITH2024', read: true }
		);
		const fl2 = harness.addFile(
			'001-Fleeting/hl-2.md',
			'```ad-quote\ntitle: Page 5\nHighlighted text from the PDF manuscript.\n```',
			{ 'citation-key': 'smith2024', tags: ['note'] }
		);
		harness.addFile('999-Other/hl-3.md', 'Outside fleeting', {
			'citation-key': 'smith2024',
		});

		const state = await service.getPaperState(litFile);
		expect(state).not.toBeNull();
		expect(state!.citekey).toBe('smith2024');
		expect(state!.report1File).toBeNull();
		expect(state!.report2File).toBe(report2File);
		expect(state!.projects).toEqual(['[[ProjA]]', '[[ProjB]]']);
		expect(state!.codeUrl).toBe('https://github.com/smith/leases');
		expect(harness.getFrontmatter(litFile.path)?.code).toBe(
			'https://github.com/smith/leases'
		);
		expect(state!.doiUrl).toBe('https://doi.org/10.1145/999999');
		expect(state!.deepReportUrl).toBe(
			'https://gemini.google.com/share/deep-smith2024'
		);
		expect(state!.externalReportUrl).toBe(
			'https://chatgpt.com/share/ext-smith2024'
		);
		expect(state!.takeawaySummary.tldr).toBe('Fast cache leases.');
		expect(state!.takeawayCandidates).toHaveLength(1);
		expect(state!.fleetingNotes).toEqual([
			{ file: fl1, thought: 'Key insight on lease renewal.', read: true },
			{
				file: fl2,
				thought: 'Highlighted text from the PDF manuscript.',
				read: false,
			},
		]);
	});

	it('getPaperState handles missing companion files, full HTTP DOI/URL fallback, and unkeyed files', async () => {
		const unkeyed = makeVaultFile('002-Literature/unkeyed.md');
		expect(await service.getPaperState(unkeyed)).toBeNull();

		const bareLit = harness.addFile('002-Literature/bare2025.md', '', {
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

	it('getPaperState excludes companion Takeaway, Report 1, Report 2, and Core Note files from fleetingNotes even when folders overlap and companions carry citekey frontmatter', async () => {
		settings.paperWorkspace = {
			...settings.paperWorkspace,
			literatureNotePath: '002-Literature/100-Zotero/@{{citekey}}.md',
			highlightNotesFolder: '002-Literature',
		};
		const litFile = harness.addFile(
			'002-Literature/100-Zotero/@linDrGPUMGuidingMemory2023.md',
			'',
			{ 'citation-key': '@linDrGPUMGuidingMemory2023' }
		);
		const paths = resolvePaperPaths(
			settings.paperWorkspace,
			'@linDrGPUMGuidingMemory2023'
		);

		harness.addFile(
			paths.takeaway,
			'## 📊 Research Profile\n- 💊 **TL;DR**:: Ok.',
			{
				citekey: 'linDrGPUMGuidingMemory2023',
				type: 'literature',
			}
		);
		harness.addFile(paths.report1, '# Deep', {
			citekey: 'linDrGPUMGuidingMemory2023',
			type: 'literature',
		});
		harness.addFile(paths.report2, '# External', {
			citekey: 'linDrGPUMGuidingMemory2023',
			type: 'literature',
		});
		harness.addFile(paths.coreNote, 'Core body', {
			'citation-key': 'linDrGPUMGuidingMemory2023',
			type: 'literature',
		});
		const genuineFleeting = harness.addFile(
			'002-Literature/999-Highlights/hl-lin.md',
			'## Thoughts\nActual highlight thought.',
			{ citekey: 'linDrGPUMGuidingMemory2023', status: 'read' }
		);

		const state = await service.getPaperState(litFile);
		expect(state).not.toBeNull();
		expect(state!.fleetingNotes).toEqual([
			{
				file: genuineFleeting,
				thought: 'Actual highlight thought.',
				read: true,
			},
		]);
	});

	it('createOrOpenReportFile returns existing files untouched and renders 4-type YAML frontmatter with rich metadata and @citekey support for report1, report2, takeaway, and coreNote', async () => {
		const litFile = harness.addFile('002-Literature/open2025.md', '', {
			'citation-key': 'open2025',
			title: 'Systems "Scale" Study',
			doi: '10.1145/open2025',
			'short-name': 'ScaleSys',
			authors: ['Alice-Smith', 'Bob "B." Jones'],
			venue: '[[OSDI 2025]]',
			'publish-type': 'conferencePaper',
		});

		const parseFm = (raw: string): Record<string, unknown> => {
			const match = raw.match(/^---\n([\s\S]*?)\n---\n/);
			expect(match).not.toBeNull();
			const parsed = yaml.load(match![1]) as Record<string, unknown>;
			if (parsed.create instanceof Date) {
				parsed.create = parsed.create.toISOString().slice(0, 10);
			}
			return parsed;
		};

		const r1 = await service.createOrOpenReportFile('open2025', 'report1', litFile);
		expect(r1.path).toBe(
			'002-Literature/102-Analysis Report/Deep Research-open2025.md'
		);
		expect(harness.getContent(r1.path)).not.toBe('');
		const r1Fm = parseFm(harness.getContent(r1.path)!);
		expect(r1Fm.id).toMatch(/^[a-z0-9]{16}$/);
		expect(r1Fm).toEqual({
			id: r1Fm.id,
			create: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
			title: 'Deep Research-open2025',
			type: 'literature',
			url: '',
			tags: ['source/🤖AI'],
			aliases: [r1Fm.id],
			sources: ['[[open2025]]'],
			'need-attention': false,
			notion: '',
		});

		const r2 = await service.createOrOpenReportFile('open2025', 'report2', litFile);
		expect(r2.path).toBe(
			'002-Literature/103-External Analysis Report/External Research-open2025.md'
		);
		const r2Fm = parseFm(harness.getContent(r2.path)!);
		expect(r2Fm.id).toMatch(/^[a-z0-9]{16}$/);
		expect(r2Fm).toEqual({
			id: r2Fm.id,
			create: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
			title: 'External Research-open2025',
			type: 'literature',
			url: '',
			tags: ['source/🤖AI'],
			aliases: [r2Fm.id],
			sources: ['[[open2025]]'],
			'need-attention': false,
			notion: '',
		});

		// Without passing litFile explicitly, createOrOpenReportFile still resolves paths.literatureNote from the vault!
		const tw = await service.createOrOpenReportFile('open2025', 'takeaway');
		expect(tw.path).toBe('002-Literature/101-Takeaways/Takeaway-open2025.md');
		const twFm = parseFm(harness.getContent(tw.path)!);
		expect(twFm.id).toMatch(/^[a-z0-9]{16}$/);
		expect(twFm).toEqual({
			id: twFm.id,
			create: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
			title: 'Takeaway-open2025',
			type: 'literature',
			url: '10.1145/open2025',
			tags: ['source/🤖AI'],
			aliases: [twFm.id],
			sources: ['[[Deep Research-open2025]]', '[[External Research-open2025]]'],
			'need-attention': true,
			shortName: 'ScaleSys',
			author: ['Alice-Smith', 'Bob "B." Jones'],
			venue: 'OSDI 2025',
			notion: '',
			'paper-type': 'conferencePaper',
			citekey: 'open2025',
		});

		harness.setContent(r1.path, '# Populated Deep Report');
		harness.mockApp.vault.create.mockClear();
		const existingR1 = await service.createOrOpenReportFile(
			'open2025',
			'report1',
			litFile
		);
		expect(existingR1).toBe(r1);
		expect(harness.getContent(r1.path)).toBe('# Populated Deep Report');
		expect(harness.mockApp.vault.create).not.toHaveBeenCalled();

		const core = await service.createOrOpenReportFile(
			'open2025',
			'coreNote',
			litFile
		);
		expect(core.path).toBe('002-Literature/104-Paper Notes/open2025.md');
		expect(parseFm(harness.getContent(core.path)!)).toEqual({
			'citation-key': 'open2025',
			type: 'literature',
			source: '[[open2025|open2025]]',
			create: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
			projects: [],
			'linked-notes': [],
			tags: ['type/paper-note'],
		});
		expect(parseCoreNoteContent(harness.getContent(core.path)!)).toEqual({
			citekey: 'open2025',
			source: '[[open2025|open2025]]',
			projects: [],
			linkedNotes: [],
			body: '',
			extraFrontmatter: {
				create: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
				tags: ['type/paper-note'],
			},
		});

		// Verify @-prefixed citekey + @{{citekey}}.md literatureNotePath + secondary frontmatter keys (url, shortName, author, publication, paper-type)
		settings.paperWorkspace = {
			...settings.paperWorkspace,
			literatureNotePath: '002-Literature/100-Zotero/@{{citekey}}.md',
		};
		settings.prompts = [];
		const atLitFile = harness.addFile(
			'002-Literature/100-Zotero/@linDrGPUMGuidingMemory2023.md',
			'',
			{
				citekey: '@linDrGPUMGuidingMemory2023',
				url: 'https://arxiv.org/abs/2301.00001',
				shortName: 'DrGPUM',
				author: 'Lin-2023',
				publication: '[[ASPLOS 2023]]',
				'paper-type': 'journalArticle',
			}
		);
		const atR1 = await service.createOrOpenReportFile(
			'@linDrGPUMGuidingMemory2023',
			'report1',
			atLitFile
		);
		expect(atR1.path).toBe(
			'002-Literature/102-Analysis Report/Deep Research-linDrGPUMGuidingMemory2023.md'
		);
		expect(parseFm(harness.getContent(atR1.path)!).sources).toEqual([
			'[[@linDrGPUMGuidingMemory2023]]',
		]);

		const atCore = await service.createOrOpenReportFile(
			'@linDrGPUMGuidingMemory2023',
			'coreNote',
			atLitFile
		);
		expect(parseFm(harness.getContent(atCore.path)!).source).toBe(
			'[[@linDrGPUMGuidingMemory2023|linDrGPUMGuidingMemory2023]]'
		);

		const atTw = await service.createOrOpenReportFile(
			'@linDrGPUMGuidingMemory2023',
			'takeaway',
			atLitFile
		);
		const atTwFm = parseFm(harness.getContent(atTw.path)!);
		expect(atTwFm.url).toBe('https://arxiv.org/abs/2301.00001');
		expect(atTwFm.shortName).toBe('DrGPUM');
		expect(atTwFm.author).toEqual(['Lin-2023']);
		expect(atTwFm.venue).toBe('ASPLOS 2023');
		expect(atTwFm['paper-type']).toBe('journalArticle');
		expect(atTwFm.citekey).toBe('linDrGPUMGuidingMemory2023');

		const noTitleTw = await service.createOrOpenReportFile(
			'notitle2026',
			'takeaway'
		);
		const noTitleTwFm = parseFm(harness.getContent(noTitleTw.path)!);
		expect(noTitleTwFm.title).toBe('Takeaway-notitle2026');
		expect(noTitleTwFm.author).toEqual([]);
	});

	it('rewriteCandidateLinkInTakeaway handles missing files, raw Markdown updates/insertions with word boundaries, and JSON envelopes', async () => {
		await expect(
			service.rewriteCandidateLinkInTakeaway(
				'missing2025',
				1,
				'[[003-Permanent/A - Target|A - Target]]'
			)
		).resolves.toBe(false);

		const paths = resolvePaperPaths(settings.paperWorkspace, 'rw2025');
		const takeawayFile = harness.addFile(
			paths.takeaway,
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

		await expect(
			service.rewriteCandidateLinkInTakeaway(
				'rw2025',
				99,
				'[[003-Permanent/X|X]]'
			)
		).resolves.toBe(false);

		await expect(
			service.rewriteCandidateLinkInTakeaway(
				'rw2025',
				1,
				'[[003-Permanent/A - Canonical - Vault - Zettel|A - Canonical - Vault - Zettel]]'
			)
		).resolves.toBe(true);

		const updatedRaw = harness.getContent(takeawayFile.path)!;
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

		harness.setContent(
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

		const afterInsert = harness.getContent(takeawayFile.path)!;
		expect(afterInsert).toContain(
			'### Candidate 10 [Extra]\n- **Link**: [[A - Ten - Untouched]]\n- **Link Status**: Proposed'
		);
		expect(afterInsert).toContain(
			'### Candidate 1 [Core Insights]\n- **Link**: [[003-Permanent/A - Inserted - Zettel|A - Inserted - Zettel]]\n- **Source**: Synthesis\n- **Link Status**: Existing — Linked in Vault'
		);

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
		harness.setContent(takeawayFile.path, jsonEnvelope);

		await expect(
			service.rewriteCandidateLinkInTakeaway(
				'rw2025',
				2,
				'[[003-Permanent/Sub/A - Reused - Mechanism|A - Reused - Mechanism]]'
			)
		).resolves.toBe(true);

		const parsedAfterJson = JSON.parse(
			harness.getContent(takeawayFile.path)!
		) as Record<string, unknown>;
		expect(parsedAfterJson.filename_suggestion).toBe('Takeaway-rw2025');
		expect(parsedAfterJson.metadata).toEqual({
			citekey: 'rw2025',
			title: 'Rewrite Test',
		});
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
		const litFile = harness.addFile('002-Literature/paper2024.md', '', {
			'citation-key': 'paper2024',
			code: '',
		});

		const takeawayRes = await service.saveReportMarkdown(
			'paper2024',
			'takeaway',
			JSON.stringify({
				markdown_body: '## 📊 Research Profile\n- 💊 **TL;DR**:: Unwrapped.',
			}),
			litFile
		);
		expect(takeawayRes.extractedCodeUrl).toBeNull();
		expect(harness.getContent(takeawayRes.file.path)).toBe(
			'## 📊 Research Profile\n- 💊 **TL;DR**:: Unwrapped.'
		);

		const r2Res = await service.saveReportMarkdown(
			'paper2024',
			'report2',
			'Report\n```json\n{"code_url": "https://github.com/org/first"}\n```',
			litFile
		);
		expect(r2Res.extractedCodeUrl).toBe('https://github.com/org/first');
		expect(harness.getFrontmatter(litFile.path)?.code).toBe(
			'https://github.com/org/first'
		);

		await service.saveReportMarkdown(
			'paper2024',
			'report2',
			'Updated\n```json\n{"code_url": "https://github.com/org/second"}\n```',
			litFile
		);
		expect(harness.mockApp.vault.modify).toHaveBeenCalled();
		expect(harness.getFrontmatter(litFile.path)?.code).toBe(
			'https://github.com/org/first'
		);
	});

	it('saveCoreNote creates and patches Core Note, preserves extraFrontmatter, and syncs projects to literature frontmatter', async () => {
		const litFile = harness.addFile('002-Literature/core2024.md', '', {
			'citation-key': 'core2024',
		});

		const created = await service.saveCoreNote(
			'core2024',
			{
				projects: ['[[Proj1]]'],
				linkedNotes: ['[[A - Domain - Topic - Claim]]'],
				body: 'Initial draft.',
				extraFrontmatter: {
					create: '2026-06-01',
					title: 'Core Synthesis',
					tags: ['type/paper-note', 'priority/high'],
				},
			},
			litFile
		);
		expect(harness.getFrontmatter(litFile.path)?.projects).toEqual(['[[Proj1]]']);
		expect(parseCoreNoteContent(harness.getContent(created.path)!)).toEqual({
			citekey: 'core2024',
			source: '[[002-Literature/core2024|core2024]]',
			projects: ['[[Proj1]]'],
			linkedNotes: ['[[A - Domain - Topic - Claim]]'],
			body: 'Initial draft.',
			extraFrontmatter: {
				create: '2026-06-01',
				title: 'Core Synthesis',
				tags: ['type/paper-note', 'priority/high'],
			},
		});

		await service.saveCoreNote('core2024', { body: 'Refined claim.' });
		expect(parseCoreNoteContent(harness.getContent(created.path)!)).toEqual({
			citekey: 'core2024',
			source: '[[002-Literature/core2024|core2024]]',
			projects: ['[[Proj1]]'],
			linkedNotes: ['[[A - Domain - Topic - Claim]]'],
			body: 'Refined claim.',
			extraFrontmatter: {
				create: '2026-06-01',
				title: 'Core Synthesis',
				tags: ['type/paper-note', 'priority/high'],
			},
		});
	});

	it('getBuiltInDefaultContent returns factory defaults for built-in templates and prompts and null for unknown ids', () => {
		expect(service.getBuiltInDefaultContent('zotero-template')).toBe(
			DEFAULT_ZOTERO_TEMPLATE
		);
		expect(service.getBuiltInDefaultContent('tpl-report1')).toBe(
			DEFAULT_REPORT1_NOTE_TEMPLATE
		);
		expect(service.getBuiltInDefaultContent('tpl-report2')).toBe(
			DEFAULT_REPORT2_NOTE_TEMPLATE
		);
		expect(service.getBuiltInDefaultContent('tpl-takeaway')).toBe(
			DEFAULT_TAKEAWAY_NOTE_TEMPLATE
		);
		expect(service.getBuiltInDefaultContent('tpl-core-note')).toBe(
			DEFAULT_CORE_NOTE_TEMPLATE
		);
		expect(service.getBuiltInDefaultContent('tpl-atomic-note')).toBe(
			DEFAULT_ATOMIC_NOTE_TEMPLATE
		);
		expect(service.getBuiltInDefaultContent('synthesize')).toBe(
			DEFAULT_SYNTHESIZE_PROMPT
		);
		expect(service.getBuiltInDefaultContent('report1')).toBe(
			DEFAULT_REPORT1_PROMPT
		);
		expect(service.getBuiltInDefaultContent('report2')).toBe(
			DEFAULT_REPORT2_PROMPT
		);
		expect(service.getBuiltInDefaultContent('custom-user-prompt')).toBeNull();
		expect(service.getBuiltInDefaultContent('')).toBeNull();
	});

	it('ensureBuiltinTemplatesInVault guards bare App mocks without vault.create, materializes missing files, and skips existing files', async () => {
		const bareHarness = createTestApp();
		Reflect.deleteProperty(bareHarness.mockApp.vault, 'create');
		const bareService = new PaperHubService(bareHarness.app, () => settings);
		await expect(bareService.ensureBuiltinTemplatesInVault()).resolves.toBe(0);

		const existingSynthPath = '900-Templates/prompt-synthesize.md';
		harness.addFile(existingSynthPath, '# User Customized Synthesize Prompt');

		settings.zoteroTemplate = { vaultPath: '', content: '' };
		settings.prompts = settings.prompts.map((p) =>
			p.id === 'tpl-report1' || p.id === 'report1'
				? { ...p, vaultPath: '', content: '' }
				: { ...p }
		);

		const createdCount = await service.ensureBuiltinTemplatesInVault();
		expect(createdCount).toBe(8);
		expect(settings.zoteroTemplate.vaultPath).toBe(
			'900-Templates/zotero-note-template.md'
		);
		expect(harness.getContent('900-Templates/zotero-note-template.md')).toBe(
			DEFAULT_ZOTERO_TEMPLATE
		);
		expect(harness.getContent('900-Templates/report1-note-template.md')).toBe(
			DEFAULT_REPORT1_NOTE_TEMPLATE
		);
		expect(harness.getContent('900-Templates/prompt-report1.md')).toBe(
			DEFAULT_REPORT1_PROMPT
		);
		expect(harness.getContent(existingSynthPath)).toBe(
			'# User Customized Synthesize Prompt'
		);

		harness.mockApp.vault.create.mockClear();
		await expect(service.ensureBuiltinTemplatesInVault()).resolves.toBe(0);
		expect(harness.mockApp.vault.create).not.toHaveBeenCalled();
	});

	it('moveTemplatesFolder handles no-op guards, fileManager.renameFile relocation, and read+create+delete fallback', async () => {
		await service.ensureBuiltinTemplatesInVault();
		settings.prompts.push({
			id: 'outside',
			name: 'Outside Custom',
			kind: 'prompt',
			vaultPath: 'CustomPrompts/outside.md',
			content: 'Stay put',
		});

		await expect(service.moveTemplatesFolder('', '950-Templates')).resolves.toBe(0);
		await expect(service.moveTemplatesFolder('900-Templates', '   ')).resolves.toBe(
			0
		);
		await expect(
			service.moveTemplatesFolder('900-Templates/', '900-Templates')
		).resolves.toBe(0);

		const movedViaRename = await service.moveTemplatesFolder(
			'900-Templates',
			'910-CustomTemplates'
		);
		expect(movedViaRename).toBe(9);
		expect(harness.mockApp.fileManager.renameFile).toHaveBeenCalledTimes(9);
		expect(settings.zoteroTemplate.vaultPath).toBe(
			'910-CustomTemplates/zotero-note-template.md'
		);
		expect(settings.prompts.find((p) => p.id === 'tpl-takeaway')?.vaultPath).toBe(
			'910-CustomTemplates/takeaway-note-template.md'
		);
		expect(settings.prompts.find((p) => p.id === 'outside')?.vaultPath).toBe(
			'CustomPrompts/outside.md'
		);
		expect(
			harness.getFile('910-CustomTemplates/zotero-note-template.md')
		).not.toBeNull();
		expect(harness.getFile('900-Templates/zotero-note-template.md')).toBeNull();

		Reflect.deleteProperty(harness.mockApp.fileManager, 'renameFile');

		const movedViaFallback = await service.moveTemplatesFolder(
			'910-CustomTemplates',
			'920-FallbackTemplates'
		);
		expect(movedViaFallback).toBe(9);
		expect(harness.mockApp.vault.delete).toHaveBeenCalledTimes(9);
		expect(settings.zoteroTemplate.vaultPath).toBe(
			'920-FallbackTemplates/zotero-note-template.md'
		);
		expect(
			harness.getContent('920-FallbackTemplates/zotero-note-template.md')
		).toBe(DEFAULT_ZOTERO_TEMPLATE);
		expect(
			harness.getFile('910-CustomTemplates/zotero-note-template.md')
		).toBeNull();
	});

	it('updateLiteratureCodeUrl updates frontmatter via processFrontMatter and supports regex update/insert/prepend fallbacks', async () => {
		const litFile = harness.addFile('002-Literature/code2026.md', '', {
			'citation-key': 'code2026',
			code: '',
		});

		await service.updateLiteratureCodeUrl(
			litFile,
			'  https://github.com/org/repo-one  '
		);
		expect(harness.mockApp.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
		expect(harness.getFrontmatter(litFile.path)?.code).toBe(
			'https://github.com/org/repo-one'
		);
		expect(harness.mockApp.vault.modify).not.toHaveBeenCalled();

		Reflect.set(harness.mockApp, 'fileManager', undefined);

		harness.setContent(
			litFile.path,
			[
				'---',
				'citation-key: code2026',
				'code: ""',
				'year: 2026',
				'---',
				'',
				'# Body',
			].join('\n')
		);
		await service.updateLiteratureCodeUrl(
			litFile,
			'https://github.com/org/repo-two'
		);
		expect(harness.getContent(litFile.path)).toBe(
			[
				'---',
				'citation-key: code2026',
				'code: "https://github.com/org/repo-two"',
				'year: 2026',
				'---',
				'',
				'# Body',
			].join('\n')
		);

		harness.setContent(
			litFile.path,
			['---', 'citation-key: code2026', 'year: 2026', '---', '', '# Body'].join(
				'\n'
			)
		);
		await service.updateLiteratureCodeUrl(
			litFile,
			'https://github.com/org/repo-three'
		);
		expect(harness.getContent(litFile.path)).toBe(
			[
				'---',
				'citation-key: code2026',
				'year: 2026',
				'code: "https://github.com/org/repo-three"',
				'---',
				'',
				'# Body',
			].join('\n')
		);

		harness.setContent(litFile.path, '# Plain Literature Note');
		await service.updateLiteratureCodeUrl(
			litFile,
			'https://github.com/org/repo-four'
		);
		expect(harness.getContent(litFile.path)).toBe(
			'---\ncode: "https://github.com/org/repo-four"\n---\n\n# Plain Literature Note'
		);
	});

	it('getPromptContent and savePromptToVault read/write vault prompt and template files with fallback', async () => {
		expect(await service.getPromptContent('nonexistent')).toBe('');

		const synthDefault = await service.getPromptContent('synthesize');
		expect(synthDefault).toContain('Zettelkasten Incubator');

		const customEntry: PromptTemplateEntry = {
			id: 'custom1',
			name: 'Custom 1',
			vaultPath: '002-Literature/100-Prompts/custom1',
			content: 'Fallback text',
		};
		settings.prompts.push(customEntry);
		const savedPath = await service.savePromptToVault(
			customEntry,
			'# Custom Vault Content'
		);
		expect(savedPath).toBe('002-Literature/100-Prompts/custom1.md');
		customEntry.vaultPath = savedPath;

		expect(await service.getPromptContent('custom1')).toBe(
			'# Custom Vault Content'
		);

		const blankTplEntry: PromptTemplateEntry = {
			id: 'tpl-custom',
			name: 'Custom Template',
			kind: 'template',
			vaultPath: '',
			content: '',
		};
		const blankPromptEntry: PromptTemplateEntry = {
			id: 'custom-prompt',
			name: 'Custom Prompt',
			kind: 'prompt',
			vaultPath: '',
			content: '',
		};
		await expect(
			service.savePromptToVault(blankTplEntry, '---\ntype: custom\n---')
		).resolves.toBe('900-Templates/custom-note-template.md');
		await expect(
			service.savePromptToVault(blankPromptEntry, '# Prompt')
		).resolves.toBe('900-Templates/prompt-custom-prompt.md');
	});
});
