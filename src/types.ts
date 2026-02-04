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

// --- MODULAR WEBHOOK TYPES ---
export interface WebhookHeader {
	key: string;
	value: string;
	type: 'text' | 'secret';
}

/** When set, triggering this webhook will prompt for a value; use {{name}} in body template. */
export interface WebhookInputVariable {
	name: string;   // placeholder name, e.g. "custom" → {{custom}}
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
	fullName: string;
	location: string;
	start?: string;
	end?: string;
	submissionDdl: string;
	source: CFPSource;
	url?: string;
}

export interface MyPluginSettings {
	zoteroPort: number;
	fleetingNoteFolder: string;
	metadataMapping: MetadataMapInfo[];
	assistantScript: string;
	sortProperty: string;
	webhooks: WebhookProfile[];
	annotationKeyName: string
	citationKeyName: string
	projectsFolder: string;
	projectFrontmatterKey: string;
	projectIdKey: string;
	/** When true, show a webhook icon in the left sidebar to trigger webhooks. */
	webhookShowInRibbon: boolean;
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
}

// --- NEW: DEFAULT DATAVIEW SCRIPT ---
export const DEFAULT_ASSISTANT_SCRIPT = `
dv.table(["File"], dv.pages('"Fleeting Notes"')
    .map(b => [b.file.link]))
`;

export const DEFAULT_SETTINGS: MyPluginSettings = {
	zoteroPort: 23119,
	fleetingNoteFolder: "Fleeting Notes",
	metadataMapping: [
		{ label: "Title", zoteroProp: "title", noteProp: "title", enabled: true },
		{ label: "Date", zoteroProp: "date", noteProp: "date", enabled: true },
		{ label: "Publication", zoteroProp: "publication", noteProp: "publication", enabled: true },
		{ label: "Authors", zoteroProp: "creators", noteProp: "authors", enabled: true },
		{ label: "DOI", zoteroProp: "doi", noteProp: "doi", enabled: true }
	],
	assistantScript: DEFAULT_ASSISTANT_SCRIPT, // Set the default script
	sortProperty: "color",
	webhooks: [],
	annotationKeyName: "annotation-id",
	citationKeyName: "citation-key",
	projectsFolder: 'Projects', // Default folder name
	projectFrontmatterKey: 'projects', // Default YAML key
	projectIdKey: 'project_id', // Default YAML key
	webhookShowInRibbon: false,
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
