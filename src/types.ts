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

export interface MyPluginSettings {
	zoteroPort: number;
	fleetingNoteFolder: string;
	webhookUrl: string;
	webhookCondition: string;
	metadataMapping: MetadataMapInfo[];
	assistantScript: string;
	// NEW: Sorting Property
	sortProperty: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	zoteroPort: 23119,
	fleetingNoteFolder: "Fleeting Notes",
	webhookUrl: "",
	webhookCondition: "",
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
	// Default sort by color
	sortProperty: "color"
};
