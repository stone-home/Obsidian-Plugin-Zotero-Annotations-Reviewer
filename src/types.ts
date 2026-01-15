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

// --- MODULAR WEBHOOK TYPES ---

export interface WebhookHeader {
	key: string;
	value: string;
	type: 'text' | 'secret'; // RESTORED: Secret support
}

export interface WebhookProfile {
	id: string;
	name: string;
	icon: string;
	url: string;
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	headers: WebhookHeader[];
	bodyTemplate: string;
	hidden: boolean; // NEW: Visibility toggle
}

export interface MyPluginSettings {
	zoteroPort: number;
	fleetingNoteFolder: string;
	metadataMapping: MetadataMapInfo[];
	assistantScript: string;
	sortProperty: string;
	webhooks: WebhookProfile[];
}

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
	assistantScript: "",
	sortProperty: "color",
	webhooks: []
};
