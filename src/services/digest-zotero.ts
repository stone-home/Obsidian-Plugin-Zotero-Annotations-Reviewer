import { TranslationLookup, ZoteroItemJson } from './digest-translate';
import {
	DigestHttp,
	DigestHttpResponse,
	DigestRecord,
	getHeader,
} from './digest-types';

const APP_NAME = 'Obsidian Paper Digest';
const BASE_HEADERS: Record<string, string> = {
	'Zotero-API-Version': '3',
	'Zotero-Allowed-Request': '1',
	'User-Agent': 'obsidian/zotero',
};
/** Fields a translator may emit that the Zotero write API does not accept. */
const NON_API_FIELDS = [
	'key',
	'version',
	'attachments',
	'notes',
	'seeAlso',
	'id',
	'itemID',
];
const DOI_ITEM_TYPES = new Set(['journalArticle', 'conferencePaper', 'preprint']);
const VENUE_FIELDS: Record<string, string> = {
	journalArticle: 'publicationTitle',
	conferencePaper: 'proceedingsTitle',
	preprint: 'repository',
};

/** A Zotero collection, with its full path for display. */
export type ZoteroCollection = {
	key: string;
	name: string;
	path: string;
	depth: number;
};

/** What the local Zotero answered when probed. */
export type ZoteroStatus =
	| { state: 'online'; collections: ZoteroCollection[] }
	| { state: 'offline' }
	| { state: 'disabled' }
	| { state: 'error'; message: string };

/** Outcome of creating an item. */
export type ZoteroWriteResult =
	{ ok: true; key: string } | { ok: false; reason: string };

/** Persistence of the local API key (secret storage in production). */
export type ZoteroKeyStore = {
	get(): Promise<string | null>;
	set(key: string | null): Promise<void>;
};

/** Outcome of the accept pipeline. */
export type DigestAcceptResult =
	{ ok: true; key: string } | { ok: false; reason: string; canSaveBasic: boolean };

/** Orders collections as a tree and gives each its full path. */
export function buildCollectionList(raw: unknown): ZoteroCollection[] {
	type Node = { key: string; name: string; parent: string | null };
	const nodes = new Map<string, Node>();
	for (const entry of Array.isArray(raw) ? raw : []) {
		const data = (entry?.data ?? entry) as Record<string, unknown> | undefined;
		const key = entry?.key ?? data?.key;
		if (typeof key !== 'string' || typeof data?.name !== 'string') continue;
		const parent =
			typeof data.parentCollection === 'string' ? data.parentCollection : null;
		nodes.set(key, { key, name: data.name, parent });
	}
	const resolve = (node: Node, seen: Set<string>): string[] => {
		const parent = node.parent ? nodes.get(node.parent) : undefined;
		if (!parent || seen.has(parent.key)) return [node.name];
		seen.add(parent.key);
		return [...resolve(parent, seen), node.name];
	};
	return Array.from(nodes.values())
		.map((node) => {
			const names = resolve(node, new Set([node.key]));
			return {
				key: node.key,
				name: node.name,
				path: names.join(' / '),
				depth: names.length - 1,
			};
		})
		.sort((a, b) => a.path.localeCompare(b.path));
}

/** Tags written for the chosen research directions. */
export function directionTags(prefix: string, directions: string[]): { tag: string }[] {
	return directions.map((id) => ({ tag: prefix + id }));
}

/**
 * Prepares a looked-up item for writing: translator tags are replaced by the
 * direction tags and the item is placed in the chosen collection (an empty
 * key leaves it at the library root).
 */
export function prepareLookupItem(
	item: ZoteroItemJson,
	tags: { tag: string }[],
	collectionKey: string
): ZoteroItemJson {
	const prepared: ZoteroItemJson = { ...item };
	for (const field of NON_API_FIELDS) delete prepared[field];
	prepared.tags = tags;
	prepared.collections = collectionKey ? [collectionKey] : [];
	return prepared;
}

/** Builds an item from the fields of the record itself, for papers without a DOI. */
export function buildBasicItem(
	record: DigestRecord,
	tags: { tag: string }[],
	collectionKey: string
): ZoteroItemJson {
	const itemType = record.item_type || 'journalArticle';
	const item: ZoteroItemJson = {
		itemType,
		title: record.title,
		tags,
		collections: collectionKey ? [collectionKey] : [],
	};
	if (record.abstract) item.abstractNote = record.abstract;
	if (record.url) item.url = record.url;
	if (record.year !== undefined) item.date = String(record.year);
	if (record.venue && VENUE_FIELDS[itemType])
		item[VENUE_FIELDS[itemType]] = record.venue;
	if (record.doi) {
		if (DOI_ITEM_TYPES.has(itemType)) item.DOI = record.doi;
		else item.extra = `DOI: ${record.doi}`;
	}
	return item;
}

/** Client of the local API served by a running Zotero. */
export class ZoteroLocalClient {
	private serverId: string | undefined;

	constructor(
		private readonly http: DigestHttp,
		private readonly getPort: () => number,
		private readonly keys: ZoteroKeyStore
	) {}

	private url(path: string): string {
		return `http://127.0.0.1:${this.getPort()}${path}`;
	}

	/**
	 * Probes Zotero and reads its collections. The same request also yields
	 * the server id that write requests must carry.
	 */
	async status(): Promise<ZoteroStatus> {
		let response: DigestHttpResponse;
		try {
			response = await this.http({
				url: this.url('/api/users/0/collections'),
				method: 'GET',
				headers: BASE_HEADERS,
			});
		} catch {
			return { state: 'offline' };
		}
		if (response.status === 403) return { state: 'disabled' };
		if (response.status !== 200) {
			return {
				state: 'error',
				message: `Zotero answered HTTP ${response.status}`,
			};
		}
		this.serverId = getHeader(response.headers, 'Zotero-Server-ID');
		try {
			return {
				state: 'online',
				collections: buildCollectionList(JSON.parse(response.text)),
			};
		} catch {
			return {
				state: 'error',
				message: 'Zotero returned an unreadable collection list',
			};
		}
	}

	/**
	 * Asks Zotero for a write key; Zotero shows an approval prompt.
	 * @throws Error when the request is denied or writes are not supported.
	 */
	private async authorize(): Promise<string> {
		const response = await this.http({
			url: this.url('/api/local/authorize'),
			method: 'POST',
			contentType: 'application/json',
			headers: {
				...BASE_HEADERS,
				'Content-Type': 'application/json',
				'Zotero-Server-ID': this.serverId ?? '',
			},
			body: JSON.stringify({ appName: APP_NAME }),
		});
		if (response.status === 404) {
			throw new Error('This Zotero version does not support local writes');
		}
		if (response.status === 403) {
			throw new Error(
				response.text.includes('not enabled')
					? 'Zotero local API is not enabled'
					: 'Write access was denied in Zotero'
			);
		}
		if (response.status !== 200) {
			throw new Error(`Zotero authorization failed (HTTP ${response.status})`);
		}
		const body = JSON.parse(response.text) as { key?: string; remember?: boolean };
		if (!body.key) throw new Error('Zotero returned no write key');
		if (body.remember) await this.keys.set(body.key);
		return body.key;
	}

	private postItem(item: ZoteroItemJson, key: string): Promise<DigestHttpResponse> {
		return this.http({
			url: this.url('/api/users/0/items'),
			method: 'POST',
			contentType: 'application/json',
			headers: {
				...BASE_HEADERS,
				'Content-Type': 'application/json',
				'Zotero-API-Key': key,
				'Zotero-Server-ID': this.serverId ?? '',
			},
			body: JSON.stringify([item]),
		});
	}

	/** Creates one item and returns its Zotero key. */
	async createItem(item: ZoteroItemJson): Promise<ZoteroWriteResult> {
		try {
			if (!this.serverId) {
				const status = await this.status();
				if (status.state !== 'online') {
					return { ok: false, reason: 'Zotero is not reachable' };
				}
			}
			let key = (await this.keys.get()) ?? (await this.authorize());
			let response = await this.postItem(item, key);
			if (response.status === 401) {
				await this.keys.set(null);
				key = await this.authorize();
				response = await this.postItem(item, key);
			}
			if (response.status === 403) {
				return { ok: false, reason: 'Zotero local API is not enabled' };
			}
			if (response.status !== 200) {
				return {
					ok: false,
					reason: `Zotero refused the item (HTTP ${response.status}): ${response.text.slice(0, 200)}`,
				};
			}
			return this.readWriteResult(response.text);
		} catch (e) {
			return { ok: false, reason: (e as Error).message };
		}
	}

	private readWriteResult(text: string): ZoteroWriteResult {
		const body = JSON.parse(text) as {
			success?: Record<string, string>;
			successful?: Record<string, { key?: string }>;
			failed?: Record<string, { message?: string; code?: number }>;
		};
		const key = body.success?.['0'] ?? body.successful?.['0']?.key;
		if (key) return { ok: true, key };
		const failure = body.failed?.['0'];
		return {
			ok: false,
			reason: failure?.message
				? `Zotero rejected the item: ${failure.message}`
				: 'Zotero did not report a created item',
		};
	}
}

/** The services the accept pipeline needs. */
export type DigestAcceptDeps = {
	lookup(identifier: string): Promise<TranslationLookup>;
	createItem(item: ZoteroItemJson): Promise<ZoteroWriteResult>;
};

/**
 * Creates the Zotero item for an accepted paper: metadata is resolved from the
 * DOI, or taken from the record itself when `basic` is set.
 */
export async function acceptRecord(
	deps: DigestAcceptDeps,
	record: DigestRecord,
	tags: { tag: string }[],
	collectionKey: string,
	basic = false
): Promise<DigestAcceptResult> {
	let item: ZoteroItemJson;
	if (basic) {
		item = buildBasicItem(record, tags, collectionKey);
	} else {
		if (!record.doi) {
			return {
				ok: false,
				reason: 'This paper has no DOI to look up',
				canSaveBasic: true,
			};
		}
		const found = await deps.lookup(record.doi);
		if (!found.ok) {
			return {
				ok: false,
				reason: found.reason,
				canSaveBasic: !found.unreachable,
			};
		}
		item = prepareLookupItem(found.item, tags, collectionKey);
	}
	const written = await deps.createItem(item);
	if (written.ok) return written;
	return { ok: false, reason: written.reason, canSaveBasic: false };
}
