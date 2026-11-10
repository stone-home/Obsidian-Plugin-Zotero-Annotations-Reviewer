/** Lifecycle state of a paper in the digest store. */
export type DigestStatus = 'unchecked' | 'accepted' | 'rejected';

/** One paper as supplied by a writer (JSONL line or converted BibTeX entry). */
export type DigestInput = {
	key: string;
	title: string;
	doi?: string;
	url?: string;
	year?: number;
	venue?: string;
	abstract?: string;
	item_type?: string;
};

/** A paper held in the digest store, with its triage decision. */
export type DigestRecord = DigestInput & {
	status: DigestStatus;
	added_at: string;
	decided_at?: string;
	reject_reason?: string;
	directions?: string[];
	collections?: { key: string; name: string }[];
	zotero_key?: string;
	/** Accepted without a Zotero item: the user imports it by hand. */
	manual_import?: boolean;
	batch?: string;
};

/** An incoming line that failed validation, kept until the user clears it. */
export type DigestInvalidLine = {
	raw: string;
	reason: string;
	file: string;
	at: string;
};

/** On-disk shape of `digest-store.json`. */
export type DigestStoreData = {
	version: 1;
	records: Record<string, DigestRecord>;
	invalid: DigestInvalidLine[];
};

/** An entry of a fixed vocabulary (research direction or reject reason). */
export type DigestVocabItem = {
	id: string;
	label: string;
	archived?: boolean;
};

/** Plugin settings of the Paper Digest feature. */
export type DigestSettings = {
	incomingFolder: string;
	translationServerUrl: string;
	directions: DigestVocabItem[];
	tagPrefix: string;
	rejectReasons: DigestVocabItem[];
	retentionDays: number;
	showInRibbon: boolean;
	/** Used only when Obsidian secret storage is unavailable. */
	zoteroApiKey: string;
	lastDirections: string[];
	lastCollectionKeys: string[];
};

/** Defaults applied to any digest setting the user has not set. */
export const DEFAULT_DIGEST_SETTINGS: DigestSettings = {
	incomingFolder: 'Digest/Incoming',
	translationServerUrl: 'http://127.0.0.1:1969',
	directions: [],
	tagPrefix: 'dir/',
	rejectReasons: [
		{ id: 'off-topic', label: 'Off-topic' },
		{ id: 'low-quality', label: 'Low quality' },
		{ id: 'already-have', label: 'Already have' },
		{ id: 'too-old', label: 'Too old' },
		{ id: 'other', label: 'Other' },
	],
	retentionDays: 30,
	showInRibbon: true,
	zoteroApiKey: '',
	lastDirections: [],
	lastCollectionKeys: [],
};

/** Merges stored digest settings over the defaults. */
export function resolveDigestSettings(
	stored?: Partial<DigestSettings>
): DigestSettings {
	return { ...DEFAULT_DIGEST_SETTINGS, ...(stored ?? {}) };
}

/**
 * Vocabulary entries that can be offered in the triage window. An entry
 * without an id takes one derived from its label.
 */
export function activeVocab(items: DigestVocabItem[]): DigestVocabItem[] {
	return items
		.filter((item) => !item.archived)
		.map((item) => ({ ...item, id: item.id.trim() || toVocabId(item.label) }))
		.filter((item) => item.id !== '');
}

/** Turns free text into a vocabulary id: lower case, digits and dashes only. */
export function toVocabId(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** HTTP request passed to {@link DigestHttp}. */
export type DigestHttpRequest = {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	contentType?: string;
};

/** HTTP response returned by {@link DigestHttp}. */
export type DigestHttpResponse = {
	status: number;
	text: string;
	headers: Record<string, string>;
};

/**
 * HTTP function injected into the digest clients. It resolves for every HTTP
 * status and rejects only when no response was received.
 */
export type DigestHttp = (request: DigestHttpRequest) => Promise<DigestHttpResponse>;

/** File access injected into the digest services (vault adapter in production). */
export type DigestFiles = {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
	/** Paths of the files directly inside `folder`. */
	list(folder: string): Promise<string[]>;
	mkdir(folder: string): Promise<void>;
};

/** Reads a response header regardless of the case of its name. */
export function getHeader(
	headers: Record<string, string>,
	name: string
): string | undefined {
	const wanted = name.toLowerCase();
	const found = Object.keys(headers).find((key) => key.toLowerCase() === wanted);
	return found ? headers[found] : undefined;
}
