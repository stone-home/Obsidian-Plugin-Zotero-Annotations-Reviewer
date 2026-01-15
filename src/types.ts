import { App } from 'obsidian';
// If you get an error saying 'secretStorage does not exist on App',
// run `npm i obsidian@latest` or restore the 'declare module' block.

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

// --- Webhook Types ---

export interface WebhookHeader {
	id: string;
	name: string; // Header Key (e.g. "Authorization")
	type: 'text' | 'secret'; // The type of input
	value: string; // The text value OR the Secret Key (if type is secret)
}

export interface WebhookCondition {
	id: string;
	logic: 'AND' | 'OR';
	field: string;
	operator: 'eq' | 'neq' | 'contains' | 'not_contains' | 'regex';
	value: string;
}

export interface MyPluginSettings {
	// General
	zoteroPort: number;
	fleetingNoteFolder: string;

	// Zotero / Highlights
	metadataMapping: MetadataMapInfo[];
	assistantScript: string;
	sortProperty: string;

	// Webhook
	webhookUrl: string;
	webhookHeaders: WebhookHeader[];
	webhookConditions: WebhookCondition[];
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	zoteroPort: 23119,
	fleetingNoteFolder: "Fleeting Notes",
	metadataMapping: [
		{ label: "Title", zoteroProp: "title", noteProp: "title", enabled: true },
		{ label: "Date", zoteroProp: "date", noteProp: "date", enabled: true },
		{ label: "Publication", zoteroProp: "publication", noteProp: "publication", enabled: true },
		{ label: "Authors", zoteroProp: "creators", noteProp: "authors", enabled: true },
		{ label: "DOI", zoteroProp: "doi", noteProp: "doi", enabled: true },
		{ label: "Publisher", zoteroProp: "publisher", noteProp: "publisher", enabled: false },
		{ label: "Pages", zoteroProp: "pages", noteProp: "pages", enabled: false }
	],
	assistantScript: "",
	sortProperty: "color",

	webhookUrl: "",
	webhookHeaders: [],
	webhookConditions: []
};
