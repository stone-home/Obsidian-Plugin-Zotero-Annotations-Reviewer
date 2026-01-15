export interface MyPluginSettings {
	zoteroPort: number;
	fleetingNoteFolder: string;
	// Webhook Settings
	webhookUrl: string;
	webhookCondition: string; // NEW: Regex string, e.g. "status: done"
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	zoteroPort: 23119,
	fleetingNoteFolder: 'Fleeting Notes',
	webhookUrl: '',
	webhookCondition: ''
};

export interface ZoteroItemMetadata {
	key: string;
	itemType: string;
	title: string;
	creators: string[];
	date: string;
	publication: string;
	doi?: string;
	url?: string;
	abstract?: string;
	tags: string[];
	zoteroNotes: Array<{
		key: string;
		title: string;
		content: string;
		cleanContent: string;
	}>;
	// NEW: Path to images (from Frontmatter)
	imageOutputPath?: string;

	volume?: string;
	issue?: string;
	pages?: string;
	publisher?: string;
	place?: string;
	series?: string;
}

export interface ZoteroAnnotation {
	key: string;
	citationKey: string;
	type: 'highlight' | 'image' | 'note' | 'ink' | 'unknown';
	text: string;
	comment: string;
	color: string;
	pageLabel: string;
	link: string;
	attachmentTitle: string;
	position?: {
		pageIndex: number;
		rects: number[][];
	};
}
