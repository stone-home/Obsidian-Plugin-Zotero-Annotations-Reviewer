import { request } from 'obsidian';
import { ZoteroAnnotation, ZoteroItemMetadata } from '../types';

/** Library selector accepted by Better BibTeX JSON-RPC (`*` = all libraries). */
type BbtLibraryId = number | '*';

/**
 * Headers used by Obsidian Zotero Integration.
 * Zotero's local HTTP server closes the connection (ERR_EMPTY_RESPONSE) for
 * browser-like requests: any Origin header, or User-Agent starting with Mozilla.
 */
const BBT_RPC_HEADERS: Record<string, string> = {
	'Content-Type': 'application/json',
	'User-Agent': 'obsidian/zotero',
	Accept: 'application/json',
	Connection: 'keep-alive'
};

export class ZoteroService {
	private port: number;
	private libraryCache: Record<string, number> | null = null;
	private readonly BBT_JSON_TRANSLATOR_ID = '36a3b0b5-bad0-4a04-b79b-441c7cef77db';

	constructor(port: number) {
		this.port = port;
	}

	async getRawMetadata(citationKey: string): Promise<any> {
		const key = this.normalizeCitationKey(citationKey);
		const libraryId = await this.resolveLibraryId(key);
		return await this.sendRpc('item.export', [[key], this.BBT_JSON_TRANSLATOR_ID, libraryId]);
	}

	async getItemMetadata(citationKey: string): Promise<ZoteroItemMetadata | null> {
		const key = this.normalizeCitationKey(citationKey);
		const libraryId = await this.resolveLibraryId(key);
		const result = await this.sendRpc('item.export', [[key], this.BBT_JSON_TRANSLATOR_ID, libraryId]);
		if (!result) return null;
		return this.parseItemMetadata(result);
	}

	async getAnnotations(citationKey: string): Promise<ZoteroAnnotation[]> {
		const key = this.normalizeCitationKey(citationKey);
		const libraryId = await this.resolveLibraryId(key);
		const rawAttachments = await this.sendRpc('item.attachments', [key, libraryId]);
		if (!rawAttachments) return [];
		return this.parseAnnotations(rawAttachments, key);
	}

	/** Strip leading `@` so BBT `item.search` can match citekeys. */
	private normalizeCitationKey(citationKey: string): string {
		return String(citationKey).replace(/^@/, '');
	}

	private parseItemMetadata(rawExport: any): ZoteroItemMetadata | null {
		let data = rawExport;
		if (typeof rawExport === 'string') {
			try {
				data = JSON.parse(rawExport);
			} catch {
				return null;
			}
		}
		if (Array.isArray(data) && data.length > 2 && typeof data[2] === 'string') {
			try {
				data = JSON.parse(data[2]);
			} catch {
				return null;
			}
		}
		const item = data.items ? data.items[0] : null;
		if (!item) return null;

		const creators =
			item.creators?.map((c: any) => c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim()) || [];
		const pubName = item.publicationTitle || item.proceedingsTitle || item.conferenceName || '';

		return {
			key: item.key,
			itemType: item.itemType || 'unknown',
			title: item.title || '',
			creators,
			date: item.date || '',
			publication: pubName,
			doi: item.DOI || '',
			url: item.url || '',
			abstract: item.abstractNote || '',
			tags: item.tags?.map((t: any) => t.tag) || [],
			zoteroNotes: [],
			volume: item.volume,
			issue: item.issue,
			pages: item.pages,
			publisher: item.publisher
		};
	}

	private parseAnnotations(attachments: any[], citationKey: string): ZoteroAnnotation[] {
		const results: ZoteroAnnotation[] = [];
		for (const att of attachments) {
			const attachmentItemKey = this.resolveAttachmentItemKey(att);
			const attachmentTitle = this.resolveAttachmentTitle(att);
			const openBase = typeof att.open === 'string' ? att.open : null;

			if (!att.annotations || !Array.isArray(att.annotations)) continue;

			for (const ann of att.annotations) {
				const pageLabel = ann.annotationPageLabel || ann.page || '?';
				results.push({
					key: ann.key,
					citationKey,
					type: this.mapAnnotationType(ann.annotationType),
					text: ann.annotationText || '',
					comment: ann.annotationComment || '',
					color: ann.annotationColor || '#aaaaaa',
					pageLabel,
					link: this.buildAnnotationLink(openBase, attachmentItemKey, pageLabel, ann.key),
					attachmentTitle,
					position: ann.annotationPosition ?? ann.position,
					date: ann.dateAdded || ann.dateModified || ann.date || ''
				});
			}
		}
		return results;
	}

	/**
	 * Current BBT returns `open` + `path`; older shapes may expose `itemKey` / `uri`.
	 */
	private resolveAttachmentItemKey(att: any): string | undefined {
		if (att.itemKey) return att.itemKey;
		if (typeof att.uri === 'string') {
			const fromUri = att.uri.split('/').pop();
			if (fromUri) return fromUri;
		}
		if (typeof att.open === 'string') {
			const match = att.open.match(/\/items\/([^/?#]+)/);
			if (match) return match[1];
		}
		return undefined;
	}

	private resolveAttachmentTitle(att: any): string {
		if (att.title) return att.title;
		if (typeof att.path === 'string' && att.path.length > 0) {
			const parts = att.path.split(/[/\\]/);
			const name = parts[parts.length - 1];
			if (name) return name;
		}
		return 'Unknown Attachment';
	}

	private buildAnnotationLink(
		openBase: string | null,
		attachmentItemKey: string | undefined,
		pageLabel: string,
		annotationKey: string
	): string {
		const page = pageLabel || '1';
		const query = `page=${page}&annotation=${annotationKey}`;
		if (openBase) {
			const sep = openBase.includes('?') ? '&' : '?';
			return `${openBase}${sep}${query}`;
		}
		return `zotero://open-pdf/library/items/${attachmentItemKey ?? ''}?${query}`;
	}

	private mapAnnotationType(rawType: string): ZoteroAnnotation['type'] {
		if (rawType === 'highlight') return 'highlight';
		if (rawType === 'image') return 'image';
		if (rawType === 'ink') return 'ink';
		if (rawType === 'note') return 'note';
		return 'unknown';
	}

	private async resolveLibraryId(citationKey: string): Promise<BbtLibraryId> {
		const searchRes = await this.sendRpc('item.search', [citationKey]);
		if (!searchRes || searchRes.length === 0) {
			throw new Error(`Citation Key '${citationKey}' not found.`);
		}
		const firstHit = searchRes[0];
		const libraryName =
			typeof firstHit === 'object' && firstHit.library ? firstHit.library : '';
		const libs = await this.fetchLibraryMap();
		if (libraryName && libs[libraryName] !== undefined) {
			return libs[libraryName];
		}
		if (!libraryName) {
			return libs['My Library'] ?? libs[''] ?? 1;
		}
		// Unknown group/library name: search across all libraries.
		return '*';
	}

	private async fetchLibraryMap(): Promise<Record<string, number>> {
		if (this.libraryCache) return this.libraryCache;
		const groups = await this.sendRpc('user.groups', []);
		this.libraryCache = { '': 1, 'My Library': 1 };
		if (Array.isArray(groups)) {
			for (const g of groups) {
				if (g?.name != null && g?.id != null) {
					this.libraryCache[g.name] = g.id;
				}
			}
		}
		return this.libraryCache;
	}

	private async sendRpc(method: string, params: any[]): Promise<any> {
		try {
			// Use `request` (not `requestUrl`): same client path as Zotero Integration,
			// and allows a non-Mozilla User-Agent that Zotero accepts.
			const text = await request({
				url: `http://127.0.0.1:${this.port}/better-bibtex/json-rpc`,
				method: 'POST',
				headers: BBT_RPC_HEADERS,
				body: JSON.stringify({ jsonrpc: '2.0', method, params })
			});
			const json = JSON.parse(text);
			if (json.error) throw new Error(JSON.stringify(json.error));
			return json.result;
		} catch (e) {
			console.error('[ZoteroService] Error:', e);
			throw e;
		}
	}
}
