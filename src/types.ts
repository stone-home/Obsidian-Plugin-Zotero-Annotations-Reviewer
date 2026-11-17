import type { DigestSettings } from './services/digest-types';

export interface ZoteroAnnotation {
	key: string;
	citationKey: string;
	type: 'highlight' | 'image' | 'ink' | 'note' | 'unknown';
	text: string;
	comment: string;
	color: string;
	pageLabel: string;
	link: string;
	attachmentTitle: string;
	date: string;
	position?: any;
}

export interface ZoteroItemMetadata {
	key: string;
	itemType: string;
	title: string;
	creators: string[];
	date: string;
	publication: string;
	doi: string;
	url: string;
	abstract: string;
	tags: string[];
	zoteroNotes: any[];
	volume?: string;
	issue?: string;
	pages?: string;
	publisher?: string;
}

export interface MetadataMapInfo {
	label: string;
	zoteroProp: string;
	noteProp: string;
	enabled: boolean;
}

// --- PAPER WORKSPACE, TEMPLATES & PROMPTS ---
export interface PaperWorkspaceConfig {
	literatureNotePath: string;
	report1Path: string;
	report2Path: string;
	takeawayPath: string;
	coreNotePath: string;
	highlightNotesFolder: string;
	atomicNotesFolder: string;
}

export interface PromptTemplateEntry {
	id: string;
	name: string;
	vaultPath: string;
	content: string;
	snapshot?: string;
	builtIn?: boolean;
}

export interface ZoteroTemplateConfig {
	vaultPath: string;
	content: string;
	snapshot?: string;
}

export const DEFAULT_PAPER_WORKSPACE: PaperWorkspaceConfig = {
	literatureNotePath: '002-Literature/{{citekey}}.md',
	report1Path: '002-Literature/102-Analysis Report/Deep Research-{{citekey}}.md',
	report2Path: '002-Literature/103-External Analysis Report/External Research-{{citekey}}.md',
	takeawayPath: '002-Literature/101-Takeaways/Takeaway-{{citekey}}.md',
	coreNotePath: '002-Literature/104-Paper Notes/{{citekey}}.md',
	highlightNotesFolder: '001-Fleeting',
	atomicNotesFolder: '003-Permanent',
};

export const DEFAULT_ZOTERO_TEMPLATE: string = [
	'---',
	'citation-key: {{citekey}}',
	'zotero-image-path: "{{imageOutputPath}}"',
	'title: "{{ title | replace(\'"\', \'\\\\"\') }}"',
	'type: literature',
	'aliases:',
	'  - "{{ title | replace(\'"\', \'\\\\"\') }}"',
	'  {%- if shortTitle.length > 0 %}',
	'  - "{{shortTitle}}"',
	'  {%- endif %}',
	'short-name: "{{shortTitle}}"',
	'authors:',
	'{%- if authors %}',
	'{%- for author in authors.split(",") %}',
	'  - {{author | trim | replace(" ", "-") | replace(".", "")}}',
	'{%- endfor %}',
	'{%- endif %}',
	'create: {{date | format("YYYY-MM-DD")}}',
	'year: {{date | format("YYYY")}}',
	'publication: "{{publicationTitle or proceedingsTitle or conferenceName}}"',
	'doi: "{{DOI}}"',
	'url: "{{url}}"',
	'publish-type: "{{itemType}}"',
	'tags:',
	'  - source/📜Zotero',
	'  - type/📰source',
	'  - status/inbox',
	'icon: {% if itemType == "conferencePaper" -%}',
	' LiNewspaper',
	'{%- elif itemType == "journalArticle" -%}',
	' FasBookJournalWhills',
	'{%- else -%}',
	' TiArticle',
	'{%- endif %}',
	'key: {{itemKey}}',
	'code: "{% for att in attachments %}{% if att.title == \'code\' %}{{ att.url | replace(\'"\', \'\\\\"\') }}{% endif %}{% endfor %}"',
	'venue: "{% set currentVenue = publicationTitle if itemType == \'journalArticle\' else ((conferenceName or proceedingsTitle) if itemType == \'conferencePaper\' else \'\') %}{% if currentVenue and currentVenue | trim %}[[{{ currentVenue | trim | replace(\'\\"\', \'\\\\\\"\') }}]]{% endif %}"',
	'deep-report: "{% for att in attachments %}{% if att.title == \'deep-report\' %}{{ att.url | replace(\'"\', \'\\\\"\') }}{% endif %}{% endfor %}"',
	'external-report: "{% for att in attachments %}{% if att.title == \'external-report\' %}{{ att.url | replace(\'"\', \'\\\\"\') }}{% endif %}{% endfor %}"',
	'---',
	'',
	'```zotero-assistant',
	'{',
	'{%- set comma = joiner() -%}{%- for annotation in annotations -%}{%- if annotation.imageRelativePath -%}{{ comma() }} "{{annotation.id}}": "{{ annotation.imageRelativePath | replace(\'\\\\\', \'\\\\\\\\\') }}"{%- endif -%}{%- endfor -%}',
	'}',
	'```',
	'',
	'## 📰 Abstract',
	'',
	'{{abstractNote}}',
	'',
	'# 🧱 Appendix',
	'## 🔖 Tags in Zotero',
	'{%- for t in tags %}',
	'  - {{t.tag}}',
	'{%- endfor %}',
	'',
	'## 💾 Persistent Data',
	'{% persist "properties" %}{%- if isFirstImport %}',
	'code::',
	'tags::',
	'{% endif %}{% endpersist %}',
].join('\n');

export const DEFAULT_SYNTHESIZE_PROMPT: string = [
	'# Zettelkasten Incubator — Paper Takeaway Synthesis',
	'',
	'You are a Zettelkasten synthesis engine. Given the paper metadata, internal deep-research report (Report 1), and external landscape report (Report 2), synthesize a structured Takeaway output.',
	'',
	'Return a valid JSON object with the shape `{ "filename_suggestion": "Takeaway-<citekey>", "metadata": { "citekey": "<citekey>", "title": "<paper title>" }, "markdown_body": "<markdown>" }` (or output `<markdown>` directly if raw Markdown is requested).',
	'',
	'The `markdown_body` MUST follow this exact section structure:',
	'',
	'## 💡 Candidate Atomic Zettels',
	'',
	'Propose 3–6 reusable atomic notes using hierarchical naming `[[A - <L1> - <L2> - <L3>]]`:',
	'',
	'### Candidate 1 [{{TypeLabel}}]',
	'- **Link**: [[A - {{L1}} - {{L2}} - {{L3}}]]',
	'- **Source**: Paper | Synthesis',
	'- **Link Status**: Proposed — No confirmed match | Existing — Matched in Vault',
	'- **Storyline**: Problem | Bottleneck | Insight | Mechanism | Trade-off',
	'- **Answers**: Problem or prior candidate this claim addresses',
	'- **Validation**: Empirical or theoretical proof backing this claim',
	'- **Evidence**: Concrete quantitative or architectural evidence from the paper',
	'- **Potential Tags**: #generatedTags/{{Tag1}}, #generatedTags/{{Tag2}}',
	'- **Brief**: 1–2 sentence atomic claim suitable for a permanent Zettel',
	'- **Related Papers**: Citekeys, DOIs, or canonical paper titles connected to this idea',
	'',
	'## 📊 Research Profile',
	'',
	'- 💊 **TL;DR**:: Single crisp sentence capturing problem, core mechanism, and headline result.',
	'- 🩻 **topic**:: Primary research domain and sub-problem.',
	'- 🧬 **position**:: Where this work sits relative to prior baselines and competing paradigms.',
	'- ✅ **contributions**:: Semicolon-separated list of verified technical contributions.',
	'- 💎 **novelty**:: Key insight that differentiates the method from prior art.',
	'- 📌 **limitation**:: Unresolved bottlenecks, assumptions, or failure modes.',
	'',
	'## 🛠️ Implementation & Reproduction',
	'',
	'Summarize critical system architecture, algorithms, hyperparameters, hardware/runtime assumptions, and artifact availability.',
	'',
	'## 🔬 Experimental Deep Dive',
	'',
	'Highlight primary benchmarks, baselines, key ablations, and surprising empirical takeaways.',
	'',
	'## 🔗 Citation Graph',
	'',
	'List foundational predecessors, direct competitors, and follow-up directions (include citekeys or DOIs when known).',
	'',
	'## 🧭 Contextual Compass',
	'',
	'Actionable takeaways: when to apply this technique, when to avoid it, and open research questions.',
].join('\n');

export const DEFAULT_REPORT1_PROMPT: string = [
	'# Report 1 — Internal Deep Research Analysis',
	'',
	'Perform a rigorous technical deep dive into this paper. Focus strictly on internal evidence from the manuscript:',
	'',
	'1. **Problem Formulation & Bottleneck**: Formal setup, motivating system/theoretical bottleneck, and why naive approaches fail.',
	'2. **Core Mechanism & Architecture**: Step-by-step breakdown of the proposed design, data structures, equations, and control/data flow.',
	'3. **Key Design Trade-offs**: Assumptions, complexity analysis, and design choices.',
	'4. **Experimental Verification & Ablations**: Workloads, baselines, headline metrics, and what each ablation proves.',
	'5. **Internal Limitations & Edge Cases**: Failure modes, sensitivity to workloads/hyperparameters, and unaddressed scenarios.',
].join('\n');

export const DEFAULT_REPORT2_PROMPT: string = [
	'# Report 2 — External Research Landscape & Code Discovery',
	'',
	'Investigate the external context around this paper across recent literature, open-source repositories, and community benchmarks:',
	'',
	'1. **Lineage & Competing Approaches**: Compare against contemporaneous and subsequent works in the same venue/domain.',
	'2. **Open-Source Artifacts & Reproduction**: Locate official or community implementations, benchmarks, and reproduction notes.',
	'3. **Practical Impact & Open Directions**: Real-world adoption, critiques, and follow-up opportunities.',
	'',
	'At the end of the report, include a machine-readable JSON block with any discovered repository URL (`null` if none exists):',
	'',
	'```json',
	'{',
	'  "code_url": "https://github.com/org/repo"',
	'}',
	'```',
].join('\n');

export const DEFAULT_PROMPTS: PromptTemplateEntry[] = [
	{
		id: 'synthesize',
		name: 'Synthesize Takeaway',
		vaultPath: '002-Literature/100-Prompts/synthesize.md',
		content: DEFAULT_SYNTHESIZE_PROMPT,
		builtIn: true,
	},
	{
		id: 'report1',
		name: 'Report 1 (Deep Research)',
		vaultPath: '002-Literature/100-Prompts/report1.md',
		content: DEFAULT_REPORT1_PROMPT,
		builtIn: true,
	},
	{
		id: 'report2',
		name: 'Report 2 (External Landscape)',
		vaultPath: '002-Literature/100-Prompts/report2.md',
		content: DEFAULT_REPORT2_PROMPT,
		builtIn: true,
	},
];

// --- MODULAR WEBHOOK TYPES ---
export interface WebhookHeader {
	key: string;
	value: string;
	type: 'text' | 'secret';
}

/** When set, triggering this webhook will prompt for a value; use {{name}} in body template. */
export interface WebhookInputVariable {
	name: string; // placeholder name, e.g. "custom" → {{custom}}
	type: 'text' | 'number';
}

export interface WebhookProfile {
	id: string;
	name: string;
	icon: string;
	url: string;
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	headers: WebhookHeader[];
	bodyTemplate: string;
	hidden: boolean;
	contentType: 'json' | 'form' | 'text';
	/** Optional: prompt for these inputs when triggering; use {{name}} in body. */
	inputVariables?: WebhookInputVariable[];
}

// --- CFP (Call For Paper) TYPES ---
export type CFPSource = 'manual' | 'wikicfp' | 'ccfddl' | 'easychair' | 'openresearch';

/** API exposed on window for DataviewJS to call plugin refresh (parse/fetch in plugin). */
export interface CFPWindowAPI {
	refreshSeries: (programUrl: string, seriesAcronym: string) => Promise<void>;
}

export interface CFPItem {
	/** Full event label (e.g. "AOSD 2026"); used for note filename. */
	acronym: string;
	/** Pure series name without year/edition (e.g. "AOSD"); used for folder and series note link. */
	series?: string;
	/**
	 * Optional ranking metadata for this conference series/event.
	 * At the storage level we only persist ranking on Series notes'
	 * frontmatter, but this structure can be used when enriching items
	 * before writing or when deriving rank from external sources.
	 */
	rank?: CFPRank;
	fullName: string;
	location: string;
	start?: string;
	end?: string;
	submissionDdl: string;
	source: CFPSource;
	url?: string;
}

/** CFP item together with its file path in the vault. */
export interface CFPItemWithPath {
	item: CFPItem;
	path: string;
}

/**
 * Normalised ranking information combining multiple sources.
 *
 * - CORE ranks are taken exclusively from a local CORE.csv file.
 * - CCF-related ranks are taken from allconf.yml (either remote or local copy).
 *
 * Only the data that is also present in Series note frontmatter is used for UI.
 */
export interface CFPRank {
	/** CCF rank (A/B/C/…); comes from allconf.yml. */
	ccf?: string;
	/** THCPL rank if present in CCF data. */
	thcpl?: string;
	/** CCF subject area (e.g. AI/DB/SE). */
	sub?: string;
	/**
	 * CORE rank letter (A*, A, B, C). This is the only field that should be
	 * interpreted as the official CORE rank; derived strictly from CORE.csv.
	 */
	coreLetter?: 'A*' | 'A' | 'B' | 'C';
	/**
	 * Raw CORE status string when it is not a simple A*, A, B, or C letter
	 * (e.g. "Unranked", "journal published", "National: USA").
	 */
	coreStatus?: string;
	/** Optional provenance information for debugging / diagnostics. */
	sources?: {
		ccfTitle?: string;
		coreAcronym?: string;
		coreName?: string;
		coreCollection?: string;
	};
}

/** Result of matching a Zotero conference-like note to CFP data. */
export interface CFPConferenceMatch {
	event: CFPItemWithPath | null;
	/** Path to the Series note (folder + "Series.md"), if available. */
	seriesNotePath?: string;
	/** Latest submission deadline among all events in this series (YYYY-MM-DD preferred). */
	latestSeriesDdl?: string;
}

export interface MyPluginSettings {
	zoteroPort: number;
	fleetingNoteFolder: string;
	metadataMapping: MetadataMapInfo[];
	assistantScript: string;
	enableLegacyAssistantScript: boolean;
	sortProperty: string;
	webhooks: WebhookProfile[];
	annotationKeyName: string;
	citationKeyName: string;
	projectsFolder: string;
	projectFrontmatterKey: string;
	projectIdKey: string;
	paperWorkspace: PaperWorkspaceConfig;
	prompts: PromptTemplateEntry[];
	zoteroTemplate: ZoteroTemplateConfig;
	/** When true, show a webhook icon in the left sidebar to trigger webhooks. */
	webhookShowInRibbon: boolean;
	/** When true, log webhook request headers and body to the console for debugging. */
	webhookDebugMode: boolean;
	// --- CFP ---
	cfpNoteDir: string;
	cfpDefaultTags: string[];
	/** Refresh interval (days) for URL sources: WikiCFP, CCFDDL, EasyChair, OpenResearch. */
	cfpRefreshDays: number;
	/** Refresh interval (days) for WikiCFP Conference Series (A–Z) scan only. */
	cfpSeriesRefreshDays: number;
	cfpWikicfpUrls: string[];
	cfpCcfddlUrls: string[];
	cfpEasychairUrls: string[];
	cfpOpenresearchUrls: string[];
	cfpLastFetchTime: number;
	cfpLastSeriesFetchTime: number;
	/** Series key -> { programUrl, lastUpdate }. Used for daily staggered refresh. */
	cfpSeriesMap: Record<string, { programUrl: string; lastUpdate: number }>;
	/** Timestamp of last daily series-refresh run. */
	cfpLastDailyRun: number;
	/** WikiCFP Series Index letters to load (e.g. ['A', 'B']). Empty array means all A-Z. */
	cfpSeriesIndexLetters: string[];
	/** DataviewJS code for Series note refresh button. */
	cfpSeriesDataviewJSCode: string;
	/** Frontmatter key to read conference acronym for direct CFP match (e.g. conference-acronym). If set and non-empty, exact match is tried first. */
	cfpAcronymKey: string;
	/** Vault-relative path to a local CORE.csv file used as the authoritative CORE ranking source. */
	cfpCoreCsvPath: string;
	/** Vault-relative path to a local allconf.yml used as a fallback when CCFDDL network fetch is unavailable. */
	cfpCcfddlLocalPath: string;
	/** Paper Digest settings; defaults are applied by the digest code when unset. */
	digest?: Partial<DigestSettings>;
}

// --- DEFAULT DATAVIEW SCRIPT ---
export const DEFAULT_ASSISTANT_SCRIPT = `
dv.table(["File"], dv.pages('"Fleeting Notes"')
    .map(b => [b.file.link]))
`;

export const DEFAULT_SETTINGS: MyPluginSettings = {
	zoteroPort: 23119,
	fleetingNoteFolder: 'Fleeting Notes',
	metadataMapping: [
		{ label: 'Title', zoteroProp: 'title', noteProp: 'title', enabled: true },
		{ label: 'Date', zoteroProp: 'date', noteProp: 'date', enabled: true },
		{ label: 'Publication', zoteroProp: 'publication', noteProp: 'publication', enabled: true },
		{ label: 'Authors', zoteroProp: 'creators', noteProp: 'authors', enabled: true },
		{ label: 'DOI', zoteroProp: 'doi', noteProp: 'doi', enabled: true },
	],
	assistantScript: DEFAULT_ASSISTANT_SCRIPT,
	enableLegacyAssistantScript: false,
	sortProperty: 'color',
	webhooks: [],
	annotationKeyName: 'annotation-id',
	citationKeyName: 'citation-key',
	projectsFolder: 'Projects',
	projectFrontmatterKey: 'projects',
	projectIdKey: 'project_id',
	paperWorkspace: { ...DEFAULT_PAPER_WORKSPACE },
	prompts: DEFAULT_PROMPTS.map((p) => ({ ...p })),
	zoteroTemplate: {
		vaultPath: '',
		content: DEFAULT_ZOTERO_TEMPLATE,
	},
	webhookShowInRibbon: false,
	webhookDebugMode: false,
	// CFP defaults
	cfpNoteDir: 'CFP',
	cfpDefaultTags: ['cfp'],
	cfpRefreshDays: 5,
	cfpSeriesRefreshDays: 30,
	cfpWikicfpUrls: [],
	cfpCcfddlUrls: [],
	cfpEasychairUrls: [],
	cfpOpenresearchUrls: [],
	cfpLastFetchTime: 0,
	cfpLastSeriesFetchTime: 0,
	cfpSeriesMap: {},
	cfpLastDailyRun: 0,
	cfpSeriesIndexLetters: [],
	cfpAcronymKey: 'conference-acronym',
	cfpCoreCsvPath: '',
	cfpCcfddlLocalPath: '',
	cfpSeriesDataviewJSCode: `const cur = dv.current();
if (cur && cur["series-url"]) {
  const programUrl = cur["series-url"];
  const seriesAcronym = (cur.file?.name || "").replace(/\\s+Series(\\.md)?$/i, "");
  const btn = dv.el("button", "Refresh events");
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    if (window.__ZoteroAnnotationReviewerCFP)
      window.__ZoteroAnnotationReviewerCFP.refreshSeries(programUrl, seriesAcronym);
  });
}`,
};
