// src/types.ts

export interface MyPluginSettings {
	zoteroPort: number;
	fleetingNoteFolder: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	zoteroPort: 23119,
	fleetingNoteFolder: 'Fleeting Notes'
};

// Expanded Metadata Structure based on your raw data
export interface ZoteroItemMetadata {
	key: string;
	itemType: string;
	title: string;
	creators: string[];   // Authors/Editors
	date: string;

	// Publication Context (Unified field)
	publication: string;  // journalTitle OR bookTitle OR proceedingsTitle

	// Specifics
	volume?: string;
	issue?: string;
	pages?: string;
	publisher?: string;
	place?: string;
	series?: string;

	doi?: string;
	url?: string;
	abstract?: string;
	tags: string[];

	// Extracted Notes (e.g., TL;DR, Research Storyline)
	zoteroNotes: Array<{
		key: string;
		title: string;
		content: string; // Raw HTML
		cleanContent: string; // Stripped Text
	}>;
}

export interface ZoteroAnnotation {
	key: string;
	citationKey: string;
	type: 'highlight' | 'image' | 'note' | 'unknown';
	text: string;
	comment: string;
	color: string;
	pageLabel: string;
	link: string;
	attachmentTitle: string;
}
