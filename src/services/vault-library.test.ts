import { App, TFile } from 'obsidian';
import yaml from 'js-yaml';
import {
	DEFAULT_PAPER_WORKSPACE,
	DEFAULT_SETTINGS,
	MyPluginSettings,
} from '../types';
import {
	PaperHubService,
	parseCoreNoteContent,
	resolvePaperPaths,
	serializeCoreNoteContent,
	TakeawayCandidate,
} from './paper-hub';
import {
	extractWikiBasename,
	normalizeVenueSeries,
	scoreLibraryMatch,
	VaultLibraryService,
	VaultPaperEntry,
} from './vault-library';

function makeVaultFile(path: string, mtime = 1000): TFile {
	const file = new TFile();
	const name = path.split('/').pop() || path;
	const basename = name.replace(/\.md$/i, '');
	Object.assign(file, {
		path,
		name,
		basename,
		extension: path.split('.').pop() || 'md',
		stat: { mtime, ctime: mtime, size: 128 },
	});
	return file;
}

describe('vault-library pure helpers', () => {
	describe('extractWikiBasename', () => {
		it('extracts lowercased basenames across plain links, folder paths, .md suffixes, aliases, headings, and empty inputs', () => {
			expect(extractWikiBasename('')).toBe('');
			expect(extractWikiBasename('   ')).toBe('');
			expect(extractWikiBasename('[[]]')).toBe('');
			expect(extractWikiBasename('[[   ]]')).toBe('');
			expect(extractWikiBasename('[[|Alias Only]]')).toBe('');
			expect(extractWikiBasename('[[#Heading Only]]')).toBe('');
			expect(extractWikiBasename('[[#heading|Alias]]')).toBe('');
			expect(extractWikiBasename('[[folder/]]')).toBe('');

			expect(extractWikiBasename('[[A - Systems - Cache Lease]]')).toBe(
				'a - systems - cache lease'
			);
			expect(extractWikiBasename('[[folder/Note.md|Alias#heading]]')).toBe('note');
			expect(
				extractWikiBasename(
					'[[003-Permanent/Sub/A - Net - ZeroCopy.MD#Implementation|ZeroCopy Alias]]'
				)
			).toBe('a - net - zerocopy');
			expect(extractWikiBasename('003-Permanent/Nested/Plain Path Note.md')).toBe(
				'plain path note'
			);
			expect(extractWikiBasename('  [[002-Literature/ongaro2014|Raft 2014]]  ')).toBe(
				'ongaro2014'
			);
		});
	});

	describe('normalizeVenueSeries', () => {
		it('normalizes wiki-links, Series suffixes, parenthetical conference acronyms, and org prefixes', () => {
			expect(normalizeVenueSeries('')).toBe('');
			expect(normalizeVenueSeries('  ""  ')).toBe('');
			expect(normalizeVenueSeries('[[OSDI]]')).toBe('OSDI');
			expect(normalizeVenueSeries('[[OSDI Series]]')).toBe('OSDI');
			expect(normalizeVenueSeries('[[CFP/OSDI/OSDI Series|OSDI 2024]]')).toBe('OSDI');
			expect(
				normalizeVenueSeries(
					"Proceedings of the 18th USENIX Symposium on Operating Systems Design and Implementation (OSDI '24)"
				)
			).toBe('OSDI');
			expect(
				normalizeVenueSeries(
					'Proceedings of the 2025 International Conference on Management of Data (ACM SIGMOD 2025)'
				)
			).toBe('SIGMOD');
			expect(normalizeVenueSeries('IEEE TPDS 2025')).toBe('TPDS');
			expect(normalizeVenueSeries('Journal of Systems Research 2024')).toBe(
				'Journal of Systems Research'
			);
			expect(normalizeVenueSeries('[[SOSP]] 2023')).toBe('SOSP');
		});
	});

	describe('scoreLibraryMatch', () => {
		const sampleEntry: VaultPaperEntry = {
			file: makeVaultFile('002-Literature/dean2008.md'),
			citekey: 'dean2008',
			title: 'MapReduce: Simplified Data Processing on Large Clusters',
			authors: ['Jeffrey-Dean', 'Sanjay-Ghemawat'],
			year: '2008',
			venue: 'Communications of the ACM',
			venueSeries: 'CACM',
			doi: '10.1145/1327452.1327492',
			url: '',
			codeUrl: '',
			projects: ['[[DistSys]]'],
			linkedNotes: [],
			tags: ['topic/mapreduce'],
			coreNoteBody: 'Deterministic task re-execution handles stragglers.',
			tldr: 'Functional map and reduce primitives scale across commodity clusters.',
			contributions: 'Fault-tolerant shuffle coordinator; combiners for network reduction.',
			novelty: 'Backup tasks mitigate tail latency.',
			limitation: 'Materializes intermediate state to local disk.',
			hasCoreNote: true,
			hasTakeaway: true,
			hasReport1: false,
			hasReport2: false,
		};

		it('returns 1 for empty queries, positive multi-field scores for matching tokens, and 0 when any token misses', () => {
			expect(scoreLibraryMatch(sampleEntry, '   ')).toBe(1);

			const exactKeyScore = scoreLibraryMatch(sampleEntry, 'dean2008');
			const partialKeyScore = scoreLibraryMatch(sampleEntry, 'dean');
			expect(exactKeyScore).toBeGreaterThan(partialKeyScore);

			const multiTokenScore = scoreLibraryMatch(
				sampleEntry,
				'mapreduce cacm ghemawat 2008 distsys stragglers combiners'
			);
			expect(multiTokenScore).toBeGreaterThan(20);

			const entryWithoutContributions: VaultPaperEntry = {
				...sampleEntry,
				contributions: undefined,
			};
			expect(scoreLibraryMatch(entryWithoutContributions, 'stragglers')).toBeGreaterThan(0);
			expect(scoreLibraryMatch(sampleEntry, 'mapreduce quantum-computing')).toBe(0);
		});
	});
});

describe('VaultLibraryService', () => {
	let app: App;
	let settings: MyPluginSettings;
	let paperHub: PaperHubService;
	let library: VaultLibraryService;
	let vaultFiles: Map<string, TFile>;
	let vaultContents: Map<string, string>;
	let frontmatters: Map<string, Record<string, any>>;

	const registerFile = (
		path: string,
		fm?: Record<string, any>,
		content = '',
		mtime = 1000
	): TFile => {
		const f = makeVaultFile(path, mtime);
		vaultFiles.set(path, f);
		vaultContents.set(path, content);
		if (fm) frontmatters.set(path, fm);
		return f;
	};

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
			Array.from(vaultFiles.values()).filter((f) => f.path.endsWith('.md'))
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

		paperHub = new PaperHubService(app, () => settings);
		library = new VaultLibraryService(app, () => settings, paperHub);
	});

	it('getLiteratureFolderPrefix handles placeholder paths, plain directories, and root patterns', () => {
		expect(library.getLiteratureFolderPrefix()).toBe('002-Literature/');

		settings.paperWorkspace.literatureNotePath = '002-Literature';
		expect(library.getLiteratureFolderPrefix()).toBe('002-Literature/');

		settings.paperWorkspace.literatureNotePath = '{{citekey}}.md';
		expect(library.getLiteratureFolderPrefix()).toBe('');
	});

	it('isPrimaryLiteratureFile accepts primary literature notes and excludes Report 1/2, Takeaway, Core Note, Fleeting, Permanent, CFP, and Prompts', () => {
		const primary = registerFile('002-Literature/osdi2024.md', {
			'citation-key': 'osdi2024',
			type: 'literature',
		});
		const outsideTyped = registerFile('Archive/classic1999.md', { type: 'literature' });
		const outsideUntyped = registerFile('Archive/random.md', { title: 'Random' });
		const nonMd = makeVaultFile('002-Literature/slides.pdf');
		const paperNoteInLit = registerFile('002-Literature/inline-paper-note.md', {
			type: 'paper-note',
		});
		const cfpSeriesInLit = registerFile('002-Literature/OSDI Series.md', {
			'cfp-series': true,
		});

		const report1 = registerFile(
			'002-Literature/102-Analysis Report/Deep Research-osdi2024.md',
			{ type: 'literature' }
		);
		const report2 = registerFile(
			'002-Literature/103-External Analysis Report/External Research-osdi2024.md'
		);
		const takeaway = registerFile('002-Literature/101-Takeaways/Takeaway-osdi2024.md');
		const coreNote = registerFile('002-Literature/104-Paper Notes/osdi2024.md');
		const highlightNote = registerFile('001-Fleeting/hl-1.md');
		const legacyFleeting = registerFile('Fleeting Notes/hl-2.md');
		const permanentNote = registerFile('003-Permanent/A - Sys - Cache - Lease.md');
		const cfpNote = registerFile('CFP/OSDI/OSDI 2025.md');
		const promptNote = registerFile('002-Literature/100-Prompts/synthesize.md');
		const templateNote = registerFile('900-Templates/zotero-note-template.md', {
			type: 'literature',
		});

		expect(library.isPrimaryLiteratureFile(primary)).toBe(true);
		expect(library.isPrimaryLiteratureFile(outsideTyped)).toBe(true);

		expect(library.isPrimaryLiteratureFile(outsideUntyped)).toBe(false);
		expect(library.isPrimaryLiteratureFile(nonMd)).toBe(false);
		expect(library.isPrimaryLiteratureFile(paperNoteInLit)).toBe(false);
		expect(library.isPrimaryLiteratureFile(cfpSeriesInLit)).toBe(false);
		expect(library.isPrimaryLiteratureFile(report1)).toBe(false);
		expect(library.isPrimaryLiteratureFile(report2)).toBe(false);
		expect(library.isPrimaryLiteratureFile(takeaway)).toBe(false);
		expect(library.isPrimaryLiteratureFile(coreNote)).toBe(false);
		expect(library.isPrimaryLiteratureFile(highlightNote)).toBe(false);
		expect(library.isPrimaryLiteratureFile(legacyFleeting)).toBe(false);
		expect(library.isPrimaryLiteratureFile(permanentNote)).toBe(false);
		expect(library.isPrimaryLiteratureFile(cfpNote)).toBe(false);
		expect(library.isPrimaryLiteratureFile(promptNote)).toBe(false);
		expect(library.isPrimaryLiteratureFile(templateNote)).toBe(false);
	});

	it('listLiteraturePapers and searchPapers sort and filter across venue, Core Note, Takeaway, and query text', async () => {
		registerFile(
			'002-Literature/alpha2024.md',
			{
				'citation-key': 'alpha2024',
				title: 'Alpha Kernel Bypass',
				authors: ['Alice-Smith'],
				year: 2024,
				venue: "Proceedings of the 18th USENIX Symposium (OSDI '24)",
				projects: ['[[KernelProj]]'],
				tags: ['topic/networking'],
			},
			'',
			2000
		);
		const alphaPaths = resolvePaperPaths(settings.paperWorkspace, 'alpha2024');
		registerFile(
			alphaPaths.coreNote,
			{},
			serializeCoreNoteContent({
				citekey: 'alpha2024',
				source: '[[002-Literature/alpha2024|alpha2024]]',
				projects: ['[[SharedProj]]'],
				linkedNotes: ['[[A - Net - RPC - ZeroCopy]]'],
				body: 'Zero-copy ring buffers cut tail latency.',
			})
		);
		registerFile(
			alphaPaths.takeaway,
			{},
			[
				'## 📊 Research Profile',
				'- 💊 **TL;DR**:: Sub-microsecond RPC over RDMA.',
				'- ✅ **contributions**:: Zero-copy ring buffer; kernel-bypass doorbell.',
			].join('\n')
		);

		// Same year, older mtime, different venue
		registerFile(
			'002-Literature/beta2024.md',
			{
				'citation-key': 'beta2024',
				title: 'Beta Consensus Protocol',
				authors: 'Bob-Jones',
				year: 2024,
				venue: '[[SOSP Series]]',
			},
			'',
			1000
		);
		// Same year & mtime as gamma -> sorted alphabetically by title
		registerFile(
			'002-Literature/gamma2022.md',
			{
				'citation-key': 'gamma2022',
				title: 'Zeta Storage Engine',
				year: 2022,
				venue: '[[OSDI]]',
			},
			'',
			500
		);
		registerFile(
			'002-Literature/delta2022.md',
			{
				'citation-key': 'delta2022',
				title: 'Delta Log Structured Merge',
				year: 2022,
				venue: '[[OSDI Series]]',
			},
			'',
			500
		);

		const all = await library.listLiteraturePapers();
		expect(all.map((e) => e.citekey)).toEqual([
			'alpha2024',
			'beta2024',
			'delta2022',
			'gamma2022',
		]);
		expect(all[0].venueSeries).toBe('OSDI');
		expect(all[0].projects).toEqual(['[[KernelProj]]', '[[SharedProj]]']);
		expect(all[0].hasCoreNote).toBe(true);
		expect(all[0].hasTakeaway).toBe(true);
		expect(all[0].tldr).toBe('Sub-microsecond RPC over RDMA.');
		expect(all[0].contributions).toBe('Zero-copy ring buffer; kernel-bypass doorbell.');
		expect(all[1].contributions).toBe('');

		const osdiOnly = await library.searchPapers('', { venue: 'OSDI' });
		expect(osdiOnly.map((e) => e.citekey)).toEqual(['alpha2024', 'delta2022', 'gamma2022']);

		const withCoreAndTakeaway = await library.searchPapers('rdma doorbell', {
			venue: 'OSDI',
			hasCoreNote: true,
			hasTakeaway: true,
		});
		expect(withCoreAndTakeaway.map((e) => e.citekey)).toEqual(['alpha2024']);
	});

	it('findSameVenuePapers groups variant venue formats and formats short labels', () => {
		const current = registerFile('002-Literature/curr2025.md', {
			'citation-key': 'curr2025',
			venue: "Proceedings of the 19th USENIX Symposium (OSDI '25)",
			year: 2025,
		});
		registerFile('002-Literature/peer1.md', {
			'citation-key': 'peer1',
			'short-name': 'Spanner',
			venue: '[[OSDI Series]]',
			year: 2024,
		});
		registerFile('002-Literature/peer2.md', {
			'citation-key': 'peer2',
			authors: ['Leslie-Lamport'],
			venue: '[[OSDI]]',
			year: 2022,
		});
		registerFile('002-Literature/otherVenue.md', {
			'citation-key': 'otherVenue',
			venue: '[[NSDI]]',
			year: 2024,
		});
		const noVenue = registerFile('002-Literature/novenue.md', {
			'citation-key': 'novenue',
		});

		const sameVenue = library.findSameVenuePapers(current);
		expect(sameVenue.map((r) => ({ citekey: r.citekey, shortLabel: r.shortLabel }))).toEqual([
			{ citekey: 'peer1', shortLabel: 'Spanner 2024' },
			{ citekey: 'peer2', shortLabel: 'Lamport 2022' },
		]);

		expect(library.findSameVenuePapers(noVenue)).toEqual([]);
		expect(library.findSameVenuePapers(noVenue, 'NSDI').map((r) => r.citekey)).toEqual([
			'otherVenue',
		]);
	});

	it('matchCandidatesAgainstVault finds exact and L2/L3 overlap Atomic Notes and matches cited vault papers by citekey and DOI', () => {
		const exactAtomic = registerFile(
			'003-Permanent/A - Systems - Caching - Lease Eviction.md'
		);
		const overlapAtomic = registerFile(
			'003-Permanent/A - Storage - Consensus - Quorum Lease Read.md'
		);

		registerFile('002-Literature/current2025.md', {
			'citation-key': 'current2025',
			title: 'Current Paper',
			year: 2025,
			doi: '10.1145/000000',
		});
		const citedByKey = registerFile('002-Literature/ongaro2014.md', {
			'citation-key': 'ongaro2014',
			title: 'In Search of an Understandable Consensus Algorithm',
			year: 2014,
		});
		const citedByDoi = registerFile('002-Literature/corbett2012.md', {
			'citation-key': 'corbett2012',
			title: 'Spanner: Google Globally-Distributed Database',
			year: 2012,
			doi: 'https://doi.org/10.1145/2491245',
		});
		registerFile('002-Literature/unrelated2020.md', {
			'citation-key': 'unrelated2020',
			title: 'Unrelated Paper',
			year: 2020,
			doi: '10.1145/888888',
		});

		const candidates: TakeawayCandidate[] = [
			{
				index: 1,
				heading: '[[A - Systems - Caching - Lease Eviction]]',
				linkTitle: 'A - Systems - Caching - Lease Eviction',
				linkStatus: 'Existing',
				storyline: '',
				evidence: '',
				brief: '',
				relatedPapers: 'ongaro2014, current2025',
				tags: [],
			},
			{
				index: 2,
				heading: '[[A - Distributed - Consensus - Quorum Lease Protocol]]',
				linkTitle: 'A - Distributed - Consensus - Quorum Lease Protocol',
				linkStatus: 'Proposed',
				storyline: '',
				evidence: '',
				brief: '',
				relatedPapers: '',
				tags: [],
			},
			{
				index: 3,
				heading: '[[A - Compilers - Register Allocation - Graph Coloring]]',
				linkTitle: 'A - Compilers - Register Allocation - Graph Coloring',
				linkStatus: 'Proposed',
				storyline: '',
				evidence: '',
				brief: '',
				relatedPapers: '',
				tags: [],
			},
		];

		const result = library.matchCandidatesAgainstVault(
			candidates,
			['Builds upon TrueTime (10.1145/2491245) and current2025 self-reference.'],
			'@current2025'
		);

		expect(result.candidateMatches[0]).toEqual({
			candidate: candidates[0],
			matchedFile: exactAtomic,
			matchType: 'exact',
			overlapScore: 1,
		});
		expect(result.candidateMatches[1].matchedFile).toBe(overlapAtomic);
		expect(result.candidateMatches[1].matchType).toBe('overlap');
		expect(result.candidateMatches[1].overlapScore).toBeGreaterThanOrEqual(0.5);

		expect(result.candidateMatches[2]).toEqual({
			candidate: candidates[2],
			matchedFile: null,
			matchType: 'none',
			overlapScore: 0,
		});

		expect(result.citedPapers).toEqual([
			{
				file: citedByKey,
				citekey: 'ongaro2014',
				title: 'In Search of an Understandable Consensus Algorithm',
				year: '2014',
				matchedBy: 'citekey',
			},
			{
				file: citedByDoi,
				citekey: 'corbett2012',
				title: 'Spanner: Google Globally-Distributed Database',
				year: '2012',
				matchedBy: 'doi',
			},
		]);
	});

	it('matchCandidatesAgainstVault resolves candidate.linkPath directly via getAbstractFileByPath before basename/overlap fallback', () => {
		const nestedAtomic = registerFile(
			'003-Permanent/Sub/A - GPU - Cache - Lease.md'
		);
		const explicitMdAtomic = registerFile('CustomVault/Notes/Custom Concept Note.md');
		const fallbackExact = registerFile(
			'003-Permanent/A - GPU - Fallback - Basename Match.md'
		);

		const candidates: TakeawayCandidate[] = [
			{
				index: 1,
				heading: '[Mechanisms]',
				typeLabel: 'Mechanisms',
				linkTitle: 'Short Alias Title',
				linkPath: '003-Permanent/Sub/A - GPU - Cache - Lease',
				linkStatus: 'Existing — Linked in Vault',
				storyline: '',
				evidence: '',
				brief: '',
				relatedPapers: '',
				tags: [],
			},
			{
				index: 2,
				heading: '[Context & Problems]',
				typeLabel: 'Context & Problems',
				linkTitle: 'Custom Concept Note',
				linkPath: 'CustomVault/Notes/Custom Concept Note.md',
				linkStatus: 'Existing',
				storyline: '',
				evidence: '',
				brief: '',
				relatedPapers: '',
				tags: [],
			},
			{
				index: 3,
				heading: '[Core Insights]',
				typeLabel: 'Core Insights',
				linkTitle: 'A - GPU - Fallback - Basename Match',
				linkPath: '003-Permanent/Missing/DoesNotExist',
				linkStatus: 'Proposed',
				storyline: '',
				evidence: '',
				brief: '',
				relatedPapers: '',
				tags: [],
			},
		];

		const result = library.matchCandidatesAgainstVault(candidates, [], 'gpu2025');

		expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith(
			'003-Permanent/Sub/A - GPU - Cache - Lease.md'
		);
		expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith(
			'CustomVault/Notes/Custom Concept Note.md'
		);
		expect(result.candidateMatches[0]).toEqual({
			candidate: candidates[0],
			matchedFile: nestedAtomic,
			matchType: 'exact',
			overlapScore: 1,
		});
		expect(result.candidateMatches[1]).toEqual({
			candidate: candidates[1],
			matchedFile: explicitMdAtomic,
			matchType: 'exact',
			overlapScore: 1,
		});
		expect(result.candidateMatches[2]).toEqual({
			candidate: candidates[2],
			matchedFile: fallbackExact,
			matchType: 'exact',
			overlapScore: 1,
		});
	});

	it('connectCandidateToVault supports reuse (with and without evidence) and create modes while updating CoreNote.linkedNotes', async () => {
		const litFile = registerFile('002-Literature/smith2024.md', {
			'citation-key': 'smith2024',
		});
		const existingAtomic = registerFile(
			'003-Permanent/A - Systems - Caching - Lease Eviction.md',
			{ type: 'permanent' },
			'# A - Systems - Caching - Lease Eviction\n\nExisting permanent note.'
		);

		const reuseCandidate: TakeawayCandidate = {
			index: 1,
			heading: '[[A - Systems - Caching - Lease Eviction]]',
			linkTitle: 'A - Systems - Caching - Lease Eviction',
			linkStatus: 'Existing',
			storyline: 'Bounds cache staleness',
			evidence: '99.9% hit ratio on read bursts',
			brief: 'Short leases avoid per-read quorum checks.',
			relatedPapers: '',
			tags: ['systems/cache', '#leases'],
		};

		// 1. Reuse with appendEvidence = true
		const reused = await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'smith2024',
			candidate: reuseCandidate,
			mode: 'reuse',
			targetFile: existingAtomic,
			appendEvidence: true,
		});
		expect(reused).toBe(existingAtomic);
		const updatedExistingText = vaultContents.get(existingAtomic.path)!;
		expect(updatedExistingText).toContain(
			'### Evidence from [[002-Literature/smith2024|smith2024]]'
		);
		expect(updatedExistingText).toContain('- **Tags**: #systems/cache #leases');

		// Calling reuse again is idempotent (does not duplicate evidence block or linkedNotes)
		await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'smith2024',
			candidate: reuseCandidate,
			mode: 'reuse',
			targetFile: existingAtomic,
			appendEvidence: true,
		});
		expect(
			vaultContents
				.get(existingAtomic.path)!
				.split('### Evidence from [[002-Literature/smith2024|smith2024]]').length - 1
		).toBe(1);

		// 2. Reuse with appendEvidence = false on another note
		const silentAtomic = registerFile(
			'003-Permanent/A - Systems - RPC - Batching.md',
			{ type: 'permanent' },
			'# Batching'
		);
		await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'smith2024',
			candidate: { ...reuseCandidate, linkTitle: 'A - Systems - RPC - Batching' },
			mode: 'reuse',
			targetFile: silentAtomic,
			appendEvidence: false,
		});
		expect(vaultContents.get(silentAtomic.path)).toBe('# Batching');

		// 3. Create mode sanitizes filename, renders tpl-atomic-note frontmatter with merged tags, and updates CoreNote.linkedNotes
		const createdAtomic = await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'smith2024',
			candidate: {
				index: 2,
				heading: '[[A - Systems - Storage: Write/Amplification?]]',
				linkTitle: 'A - Systems - Storage: Write/Amplification?',
				linkStatus: 'Proposed',
				storyline: 'Reduces compaction I/O',
				evidence: '3x lower write amplification',
				brief: 'Tiered compaction amortizes SSTable merges.',
				relatedPapers: '',
				tags: ['storage/lsm', '#type/atomic'],
			},
			mode: 'create',
		});

		expect(createdAtomic.path).toBe(
			'003-Permanent/A - Systems - Storage- Write-Amplification-.md'
		);
		const createdText = vaultContents.get(createdAtomic.path)!;
		expect(createdText).toContain('type: permanent');
		expect(createdText).toMatch(/^create: \d{4}-\d{2}-\d{2}$/m);
		expect(createdText).toContain('sources:\n  - "[[002-Literature/smith2024|smith2024]]"');
		expect(createdText).toContain('# A - Systems - Storage- Write-Amplification-');
		expect(createdText).toContain('Tiered compaction amortizes SSTable merges.');
		expect(createdText).toContain('### Evidence from [[002-Literature/smith2024|smith2024]]');

		const createdFmMatch = createdText.match(/^---\n([\s\S]*?)\n---/);
		expect(createdFmMatch).not.toBeNull();
		const createdFm = yaml.load(createdFmMatch![1]) as Record<string, any>;
		expect(createdFm.type).toBe('permanent');
		expect(createdFm.sources).toEqual(['[[002-Literature/smith2024|smith2024]]']);
		expect(createdFm.tags).toEqual(expect.arrayContaining(['type/atomic', 'storage/lsm']));
		expect(createdFm.tags).toHaveLength(2);

		const coreNotePath = resolvePaperPaths(settings.paperWorkspace, 'smith2024').coreNote;
		const savedCore = parseCoreNoteContent(vaultContents.get(coreNotePath)!);
		expect(savedCore.linkedNotes).toEqual([
			'[[A - Systems - Caching - Lease Eviction]]',
			'[[A - Systems - RPC - Batching]]',
			'[[A - Systems - Storage- Write-Amplification-]]',
		]);
	});

	it('connectCandidateToVault in create mode merges tags into custom tpl-atomic-note templates with empty or missing tags keys', async () => {
		const litFile = registerFile('002-Literature/customtpl2026.md', {
			'citation-key': 'customtpl2026',
			title: 'Custom Atomic Template Paper',
		});
		const tplEntry = settings.prompts.find((p) => p.id === 'tpl-atomic-note')!;

		// 1. Custom template with `tags: []`
		tplEntry.content = [
			'---',
			'type: permanent',
			'paper: "{{title}}"',
			'tags: []',
			'---',
			'',
			'# {{atomic_title}}',
		].join('\n');
		const emptyTagsCreated = await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'customtpl2026',
			candidate: {
				index: 1,
				heading: '[[A - Custom - Empty Tags]]',
				linkTitle: 'A - Custom - Empty Tags',
				linkStatus: 'Proposed',
				storyline: '',
				evidence: '',
				brief: '',
				relatedPapers: '',
				tags: ['#custom/one', 'custom/two'],
			},
			mode: 'create',
			appendEvidence: false,
		});
		const emptyTagsText = vaultContents.get(emptyTagsCreated.path)!;
		expect(emptyTagsText).toContain('paper: "Custom Atomic Template Paper"');
		expect(emptyTagsText).toContain('tags:\n  - custom/one\n  - custom/two');
		expect(emptyTagsText.trimEnd().endsWith('# A - Custom - Empty Tags')).toBe(true);

		// 2. Custom template without any `tags:` key
		tplEntry.content = ['---', 'type: permanent', '---', '', '# {{atomic_title}}'].join('\n');
		const noTagsKeyCreated = await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'customtpl2026',
			candidate: {
				index: 2,
				heading: '[[A - Custom - Missing Tags Key]]',
				linkTitle: 'A - Custom - Missing Tags Key',
				linkStatus: 'Proposed',
				storyline: '',
				evidence: '',
				brief: '',
				relatedPapers: '',
				tags: ['custom/appended'],
			},
			mode: 'create',
			appendEvidence: false,
		});
		expect(vaultContents.get(noTagsKeyCreated.path)).toContain(
			'type: permanent\ntags:\n  - custom/appended\n---'
		);
	});

	it('connectCandidateToVault in reuse mode rewrites Takeaway Link when chosen basename differs and includes Validation in evidence', async () => {
		const litFile = registerFile('002-Literature/mlsys2025.md', {
			'citation-key': 'mlsys2025',
		});
		const takeawayPath = resolvePaperPaths(settings.paperWorkspace, 'mlsys2025').takeaway;
		registerFile(
			takeawayPath,
			{},
			[
				'## 💡 Candidate Atomic Zettels',
				'',
				'### Candidate 1 [Context & Problems]',
				'- **Link**: [[A - ML-Sys - Memory Modeling - Proposed Liveness Name]]',
				'- **Link Status**: Proposed — No confirmed match',
				'- **Storyline**: Problem',
				'- **Validation**: Exact liveness bounds verified on Llama-70B',
				'- **Evidence**: 37% lower estimation error',
				'- **Brief**: Operator liveness intervals determine peak tensor footprint.',
			].join('\n')
		);

		const chosenVaultFile = registerFile(
			'003-Permanent/Sub/A - ML-Sys - Memory Modeling - Canonical Tensor Liveness.md',
			{ type: 'permanent' },
			'# A - ML-Sys - Memory Modeling - Canonical Tensor Liveness\n\nCanonical note body.'
		);

		const rewriteSpy = jest.spyOn(paperHub, 'rewriteCandidateLinkInTakeaway');

		const candidate: TakeawayCandidate = {
			index: 1,
			heading: '[Context & Problems]',
			typeLabel: 'Context & Problems',
			linkTitle: 'A - ML-Sys - Memory Modeling - Proposed Liveness Name',
			linkStatus: 'Proposed — No confirmed match',
			storyline: 'Problem',
			validation: 'Exact liveness bounds verified on Llama-70B',
			evidence: '37% lower estimation error',
			brief: 'Operator liveness intervals determine peak tensor footprint.',
			relatedPapers: '',
			tags: ['generatedTags/MemoryModeling'],
		};

		const connected = await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'mlsys2025',
			candidate,
			mode: 'reuse',
			targetFile: chosenVaultFile,
			appendEvidence: true,
		});

		expect(connected).toBe(chosenVaultFile);
		expect(rewriteSpy).toHaveBeenCalledTimes(1);
		expect(rewriteSpy).toHaveBeenCalledWith(
			'mlsys2025',
			1,
			'[[003-Permanent/Sub/A - ML-Sys - Memory Modeling - Canonical Tensor Liveness|A - ML-Sys - Memory Modeling - Canonical Tensor Liveness]]'
		);

		// Verify Takeaway file had - **Link**: and - **Link Status**: rewritten cleanly on their own lines
		const updatedTakeaway = vaultContents.get(takeawayPath)!;
		expect(updatedTakeaway).toContain(
			'### Candidate 1 [Context & Problems]\n- **Link**: [[003-Permanent/Sub/A - ML-Sys - Memory Modeling - Canonical Tensor Liveness|A - ML-Sys - Memory Modeling - Canonical Tensor Liveness]]'
		);
		expect(updatedTakeaway).toContain('- **Link Status**: Existing — Linked in Vault');

		// Verify appended evidence includes Validation line
		const updatedChosenContent = vaultContents.get(chosenVaultFile.path)!;
		expect(updatedChosenContent).toContain(
			'### Evidence from [[002-Literature/mlsys2025|mlsys2025]]'
		);
		expect(updatedChosenContent).toContain(
			'- **Validation**: Exact liveness bounds verified on Llama-70B'
		);
		expect(updatedChosenContent).toContain('- **Tags**: #generatedTags/MemoryModeling');

		// Explicit rewriteTakeaway: false suppresses Takeaway rewrite even when basename differs
		rewriteSpy.mockClear();
		const otherVaultFile = registerFile(
			'003-Permanent/A - ML-Sys - Alternate Zettel.md',
			{ type: 'permanent' },
			'# Alternate'
		);
		await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'mlsys2025',
			candidate,
			mode: 'reuse',
			targetFile: otherVaultFile,
			appendEvidence: false,
			rewriteTakeaway: false,
		});
		expect(rewriteSpy).not.toHaveBeenCalled();

		// Create mode when target permanent note already exists appends evidence (including Validation) instead of overwriting
		const preExistingCreateTarget = registerFile(
			'003-Permanent/A - ML-Sys - PreExisting Zettel.md',
			{ type: 'permanent' },
			'# PreExisting Zettel\n\nOriginal content.'
		);
		const reusedViaCreate = await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'mlsys2025',
			candidate: {
				...candidate,
				index: 2,
				linkTitle: 'A - ML-Sys - PreExisting Zettel',
			},
			mode: 'create',
		});
		expect(reusedViaCreate).toBe(preExistingCreateTarget);
		expect(vaultContents.get(preExistingCreateTarget.path)).toContain('Original content.');
		expect(vaultContents.get(preExistingCreateTarget.path)).toContain(
			'- **Validation**: Exact liveness bounds verified on Llama-70B'
		);
	});

	it('connectCandidateToVault rebinding an already-linked candidate replaces the previous note in CoreNote.linkedNotes', async () => {
		const litFile = registerFile('002-Literature/rebind2026.md', {
			'citation-key': 'rebind2026',
			title: 'Rebinding Candidate Notes',
		});
		const paths = resolvePaperPaths(settings.paperWorkspace, 'rebind2026');
		registerFile(
			paths.takeaway,
			{},
			[
				'## 💡 Candidate Atomic Zettels',
				'',
				'### Candidate 1 [Mechanisms]',
				'- **Link**: [[A - Systems - Caching - Initial Match]]',
				'- **Link Status**: Existing — Matched in Vault',
				'- **Storyline**: Mechanism',
				'- **Evidence**: 40% lower tail latency',
				'- **Brief**: Lease-based cache invalidation bounds staleness.',
			].join('\n')
		);

		const initialNote = registerFile(
			'003-Permanent/A - Systems - Caching - Initial Match.md',
			{ type: 'permanent' },
			'# Initial Match'
		);
		const reboundNote = registerFile(
			'003-Permanent/Sub/A - Systems - Caching - Chosen Replacement.md',
			{ type: 'permanent' },
			'# Chosen Replacement'
		);
		const thirdNote = registerFile(
			'003-Permanent/A - Systems - Caching - Final Choice.md',
			{ type: 'permanent' },
			'# Final Choice'
		);
		const movedSameNameNote = registerFile(
			'003-Permanent/Moved/A - Systems - Caching - Final Choice.md',
			{ type: 'permanent' },
			'# Moved Final Choice'
		);

		// 1. Link a note (initial binding)
		const state1 = (await paperHub.getPaperState(litFile))!;
		await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'rebind2026',
			candidate: state1.takeawayCandidates[0],
			mode: 'reuse',
			targetFile: initialNote,
			replacedFile: initialNote,
			appendEvidence: true,
		});
		expect(parseCoreNoteContent(vaultContents.get(paths.coreNote)!).linkedNotes).toEqual([
			'[[A - Systems - Caching - Initial Match]]',
		]);

		// 2. Choose another note... (rebind with replacedFile removes Initial Match and keeps only Chosen Replacement)
		const state2 = (await paperHub.getPaperState(litFile))!;
		await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'rebind2026',
			candidate: state2.takeawayCandidates[0],
			mode: 'reuse',
			targetFile: reboundNote,
			replacedFile: initialNote,
			appendEvidence: true,
			rewriteTakeaway: true,
		});
		expect(parseCoreNoteContent(vaultContents.get(paths.coreNote)!).linkedNotes).toEqual([
			'[[A - Systems - Caching - Chosen Replacement]]',
		]);
		expect(vaultContents.get(paths.takeaway)).toContain(
			'- **Link**: [[003-Permanent/Sub/A - Systems - Caching - Chosen Replacement|A - Systems - Caching - Chosen Replacement]]'
		);

		// 3. Rebind again using refreshed candidate linkPath/linkTitle when replacedFile is null
		const state3 = (await paperHub.getPaperState(litFile))!;
		await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'rebind2026',
			candidate: state3.takeawayCandidates[0],
			mode: 'reuse',
			targetFile: thirdNote,
			replacedFile: null,
			appendEvidence: false,
		});
		expect(parseCoreNoteContent(vaultContents.get(paths.coreNote)!).linkedNotes).toEqual([
			'[[A - Systems - Caching - Final Choice]]',
		]);

		// 4. Rebind to a same-basename note at a different path rewrites Takeaway without duplicating linkedNotes
		const state4 = (await paperHub.getPaperState(litFile))!;
		await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'rebind2026',
			candidate: state4.takeawayCandidates[0],
			mode: 'reuse',
			targetFile: movedSameNameNote,
			replacedFile: thirdNote,
			appendEvidence: false,
		});
		expect(vaultContents.get(paths.takeaway)).toContain(
			'- **Link**: [[003-Permanent/Moved/A - Systems - Caching - Final Choice|A - Systems - Caching - Final Choice]]'
		);
		expect(parseCoreNoteContent(vaultContents.get(paths.coreNote)!).linkedNotes).toEqual([
			'[[A - Systems - Caching - Final Choice]]',
		]);
	});

	it('connectCandidateToVault switching from a linked or matched note to create mode removes replaced note, links created note, and updates Takeaway when needed', async () => {
		const litFile = registerFile('002-Literature/switch2026.md', {
			'citation-key': 'switch2026',
			title: 'Switching Candidate To Create',
		});
		const paths = resolvePaperPaths(settings.paperWorkspace, 'switch2026');
		const legacyBoundNote = registerFile(
			'003-Permanent/Legacy/A - Systems - Legacy Bound Note.md',
			{ type: 'permanent' },
			'# Legacy Bound Note'
		);
		const overlapMatchedNote = registerFile(
			'003-Permanent/A - Systems - Work Stealing Queue.md',
			{ type: 'permanent' },
			'# Work Stealing Queue'
		);

		registerFile(
			paths.takeaway,
			{},
			[
				'## 💡 Candidate Atomic Zettels',
				'',
				'### Candidate 1 [Core Insights]',
				'- **Link**: [[003-Permanent/Legacy/A - Systems - Legacy Bound Note|A - Systems - Fresh Atomic Concept]]',
				'- **Link Status**: Existing — Linked in Vault',
				'- **Storyline**: Insight',
				'- **Evidence**: 2x throughput under skew',
				'- **Brief**: Fresh atomic concept distilled from paper.',
				'',
				'### Candidate 2 [Mechanisms]',
				'- **Link**: [[A - Systems - Scheduler: Work Stealing]]',
				'- **Link Status**: Proposed — No confirmed match',
				'- **Storyline**: Mechanism',
				'- **Evidence**: Balances tail latency across cores',
				'- **Brief**: Decentralized work-stealing deque.',
			].join('\n')
		);
		registerFile(
			paths.coreNote,
			{},
			serializeCoreNoteContent({
				citekey: 'switch2026',
				source: '[[002-Literature/switch2026|switch2026]]',
				projects: [],
				linkedNotes: [
					'[[A - Systems - Legacy Bound Note]]',
					'[[A - Systems - Work Stealing Queue]]',
				],
				body: '',
			})
		);

		// 1. Candidate 1 switches from path-linked existing note to Create a note (candLinkPath differs from created targetPath)
		const state1 = (await paperHub.getPaperState(litFile))!;
		const match1 = library.matchCandidatesAgainstVault(
			[state1.takeawayCandidates[0]],
			[],
			'switch2026'
		).candidateMatches[0];
		expect(match1.matchedFile).toBe(legacyBoundNote);

		const created1 = await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'switch2026',
			candidate: state1.takeawayCandidates[0],
			mode: 'create',
			replacedFile: legacyBoundNote,
			appendEvidence: true,
		});
		expect(created1.path).toBe('003-Permanent/A - Systems - Fresh Atomic Concept.md');
		expect(vaultContents.get(paths.takeaway)).toContain(
			'### Candidate 1 [Core Insights]\n- **Link**: [[003-Permanent/A - Systems - Fresh Atomic Concept|A - Systems - Fresh Atomic Concept]]'
		);
		expect(parseCoreNoteContent(vaultContents.get(paths.coreNote)!).linkedNotes).toEqual([
			'[[A - Systems - Work Stealing Queue]]',
			'[[A - Systems - Fresh Atomic Concept]]',
		]);

		// 2. Candidate 2 switches from overlap-matched existing note to Create a note (sanitized basename updates Takeaway)
		const state2 = (await paperHub.getPaperState(litFile))!;
		const match2 = library.matchCandidatesAgainstVault(
			[state2.takeawayCandidates[1]],
			[],
			'switch2026'
		).candidateMatches[0];
		expect(match2.matchedFile).toBe(overlapMatchedNote);
		expect(match2.matchType).toBe('overlap');

		const created2 = await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'switch2026',
			candidate: state2.takeawayCandidates[1],
			mode: 'create',
			replacedFile: overlapMatchedNote,
			appendEvidence: true,
		});
		expect(created2.path).toBe('003-Permanent/A - Systems - Scheduler- Work Stealing.md');
		expect(vaultContents.get(paths.takeaway)).toContain(
			'### Candidate 2 [Mechanisms]\n- **Link**: [[003-Permanent/A - Systems - Scheduler- Work Stealing|A - Systems - Scheduler- Work Stealing]]\n- **Link Status**: Existing — Linked in Vault'
		);
		expect(parseCoreNoteContent(vaultContents.get(paths.coreNote)!).linkedNotes).toEqual([
			'[[A - Systems - Fresh Atomic Concept]]',
			'[[A - Systems - Scheduler- Work Stealing]]',
		]);
	});

	it('connectCandidateToVault preserves a shared vault note in CoreNote.linkedNotes until no candidate on the paper uses it', async () => {
		const litFile = registerFile('002-Literature/shared2026.md', {
			'citation-key': 'shared2026',
			title: 'Shared Candidate Note Paper',
		});
		const paths = resolvePaperPaths(settings.paperWorkspace, 'shared2026');
		const sharedNote = registerFile(
			'003-Permanent/Sub/A - DistSys - Consensus - Quorum Lease.md',
			{ type: 'permanent' },
			'# Quorum Lease'
		);
		const dedicatedNote1 = registerFile(
			'003-Permanent/A - DistSys - Replication - Raft Log Compaction.md',
			{ type: 'permanent' },
			'# Raft Log Compaction'
		);
		const dedicatedNote2 = registerFile(
			'003-Permanent/A - DistSys - Storage - SSTable Bloom Filter.md',
			{ type: 'permanent' },
			'# SSTable Bloom Filter'
		);

		registerFile(
			paths.takeaway,
			{},
			[
				'## 💡 Candidate Atomic Zettels',
				'',
				'### Candidate 1 [Mechanisms]',
				'- **Link**: [[A - DistSys - Consensus - Quorum Lease]]',
				'- **Link Status**: Existing — Linked in Vault',
				'- **Storyline**: Mechanism',
				'- **Evidence**: Avoids RTT on leader reads',
				'- **Brief**: Quorum leases authorize local leader reads.',
				'',
				'### Candidate 2 [Trade-offs]',
				'- **Link**: [[003-Permanent/Sub/A - DistSys - Consensus - Quorum Lease|Quorum Lease Alias]]',
				'- **Link Status**: Existing — Linked in Vault',
				'- **Storyline**: Trade-off',
				'- **Evidence**: Bounded recovery delay on leader crash',
				'- **Brief**: Lease duration trades read throughput against failover wait.',
			].join('\n')
		);
		registerFile(
			paths.coreNote,
			{},
			serializeCoreNoteContent({
				citekey: 'shared2026',
				source: '[[002-Literature/shared2026|shared2026]]',
				projects: [],
				linkedNotes: ['[[A - DistSys - Consensus - Quorum Lease]]'],
				body: '',
			})
		);

		// 1. Rebind Candidate 1 only -> Candidate 2 still references/matches sharedNote, so sharedNote remains in linkedNotes
		const state1 = (await paperHub.getPaperState(litFile))!;
		await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'shared2026',
			candidate: state1.takeawayCandidates[0],
			mode: 'reuse',
			targetFile: dedicatedNote1,
			replacedFile: sharedNote,
			appendEvidence: true,
			rewriteTakeaway: true,
		});
		expect(parseCoreNoteContent(vaultContents.get(paths.coreNote)!).linkedNotes).toEqual([
			'[[A - DistSys - Consensus - Quorum Lease]]',
			'[[A - DistSys - Replication - Raft Log Compaction]]',
		]);

		// 2. Rebind Candidate 2 as well -> no candidate references/matches sharedNote anymore, so sharedNote is pruned
		const state2 = (await paperHub.getPaperState(litFile))!;
		await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'shared2026',
			candidate: state2.takeawayCandidates[1],
			mode: 'reuse',
			targetFile: dedicatedNote2,
			replacedFile: sharedNote,
			appendEvidence: true,
			rewriteTakeaway: true,
		});
		expect(parseCoreNoteContent(vaultContents.get(paths.coreNote)!).linkedNotes).toEqual([
			'[[A - DistSys - Replication - Raft Log Compaction]]',
			'[[A - DistSys - Storage - SSTable Bloom Filter]]',
		]);
	});

	it('connectCandidateToVault preserves unrelated cited and manual wikilinks (including path/alias wikilinks) and avoids duplicates on idempotent re-linking', async () => {
		const litFile = registerFile('002-Literature/preserve2026.md', {
			'citation-key': 'preserve2026',
			title: 'Preserving Unrelated Linked Notes',
		});
		const paths = resolvePaperPaths(settings.paperWorkspace, 'preserve2026');
		const oldCandidateNote = registerFile(
			'003-Permanent/Old/A - Systems - Old Candidate Link.md',
			{ type: 'permanent' },
			'# Old Candidate Link'
		);
		const newCanonicalNote = registerFile(
			'003-Permanent/A - Systems - New Canonical Note.md',
			{ type: 'permanent' },
			'# New Canonical Note'
		);
		const customPathNote = registerFile(
			'003-Permanent/Manual/Custom Path Note.md',
			{ type: 'permanent' },
			'# Custom Path Note'
		);

		registerFile(
			paths.takeaway,
			{},
			[
				'## 💡 Candidate Atomic Zettels',
				'',
				'### Candidate 1 [Mechanisms]',
				'- **Link**: [[003-Permanent/Old/A - Systems - Old Candidate Link|A - Systems - Old Candidate Link]]',
				'- **Link Status**: Existing — Linked in Vault',
				'- **Storyline**: Mechanism',
				'- **Evidence**: Verified across benchmarks',
				'- **Brief**: Replaces obsolete candidate binding.',
				'',
				'### Candidate 2 [Context & Problems]',
				'- **Link**: [[A - Systems - Unmatched Proposal]]',
				'- **Link Status**: Proposed — No confirmed match',
				'- **Storyline**: Problem',
				'- **Evidence**: Baseline bottleneck',
				'- **Brief**: Connects to an already manually linked path/alias note.',
			].join('\n')
		);
		registerFile(
			paths.coreNote,
			{},
			serializeCoreNoteContent({
				citekey: 'preserve2026',
				source: '[[002-Literature/preserve2026|preserve2026]]',
				projects: ['[[KernelProject]]'],
				linkedNotes: [
					'[[ongaro2014]]',
					'[[Manual Architecture Scratchpad]]',
					'[[003-Permanent/Manual/Custom Path Note.md|Custom Alias]]',
					'[[Archive/Reference Note#Design|Ref Design]]',
					'[[003-Permanent/Old/A - Systems - Old Candidate Link.md|Old Candidate Alias]]',
				],
				body: 'Existing core synthesis body.',
			})
		);

		// 1. Rebind Candidate 1 -> removes path/alias entry for Old Candidate Link while keeping all unrelated entries intact
		const state1 = (await paperHub.getPaperState(litFile))!;
		await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'preserve2026',
			candidate: state1.takeawayCandidates[0],
			mode: 'reuse',
			targetFile: newCanonicalNote,
			replacedFile: oldCandidateNote,
			appendEvidence: true,
			rewriteTakeaway: true,
		});

		const expectedLinks = [
			'[[ongaro2014]]',
			'[[Manual Architecture Scratchpad]]',
			'[[003-Permanent/Manual/Custom Path Note.md|Custom Alias]]',
			'[[Archive/Reference Note#Design|Ref Design]]',
			'[[A - Systems - New Canonical Note]]',
		];
		const savedAfterRebind = parseCoreNoteContent(vaultContents.get(paths.coreNote)!);
		expect(savedAfterRebind.linkedNotes).toEqual(expectedLinks);
		expect(savedAfterRebind.projects).toEqual(['[[KernelProject]]']);
		expect(savedAfterRebind.body).toBe('Existing core synthesis body.');

		// 2. Idempotent re-linking on Candidate 1 does not duplicate [[A - Systems - New Canonical Note]]
		const state2 = (await paperHub.getPaperState(litFile))!;
		await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'preserve2026',
			candidate: state2.takeawayCandidates[0],
			mode: 'reuse',
			targetFile: newCanonicalNote,
			replacedFile: newCanonicalNote,
			appendEvidence: true,
		});
		expect(parseCoreNoteContent(vaultContents.get(paths.coreNote)!).linkedNotes).toEqual(
			expectedLinks
		);

		// 3. Linking Candidate 2 to a note already present via path/alias wikilink neither duplicates nor strips its alias
		await library.connectCandidateToVault({
			literatureFile: litFile,
			citekey: 'preserve2026',
			candidate: state2.takeawayCandidates[1],
			mode: 'reuse',
			targetFile: customPathNote,
			replacedFile: null,
			appendEvidence: false,
			rewriteTakeaway: true,
		});
		expect(parseCoreNoteContent(vaultContents.get(paths.coreNote)!).linkedNotes).toEqual(
			expectedLinks
		);
	});
});
