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

export interface WebhookProfile {
	id: string;
	name: string;
	icon: string;
	url: string;
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	headers: WebhookHeader[];
	bodyTemplate: string;
	hidden: boolean;
	contentType: 'json' | 'form' | 'text'; // NEW: Explicit content type option
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
};
