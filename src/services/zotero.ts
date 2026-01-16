import { requestUrl } from 'obsidian';
import { ZoteroAnnotation, ZoteroItemMetadata } from '../types';

export class ZoteroService {
	private port: number;
	private libraryCache: Record<string, number> | null = null;
	private readonly BBT_JSON_TRANSLATOR_ID = '36a3b0b5-bad0-4a04-b79b-441c7cef77db';

	constructor(port: number) {
		this.port = port;
	}

	async getRawMetadata(citationKey: string): Promise<any> {
		const libraryId = await this.resolveLibraryId(citationKey);
		return await this.sendRpc('item.export', [[citationKey], this.BBT_JSON_TRANSLATOR_ID, libraryId]);
	}

	async getItemMetadata(citationKey: string): Promise<ZoteroItemMetadata | null> {
		const libraryId = await this.resolveLibraryId(citationKey);
		const result = await this.sendRpc('item.export', [[citationKey], this.BBT_JSON_TRANSLATOR_ID, libraryId]);
		if (!result) return null;
		return this.parseItemMetadata(result);
	}

	async getAnnotations(citationKey: string): Promise<ZoteroAnnotation[]> {
		const libraryId = await this.resolveLibraryId(citationKey);
		const rawAttachments = await this.sendRpc('item.attachments', [citationKey, libraryId]);
		if (!rawAttachments) return [];
		return this.parseAnnotations(rawAttachments, citationKey);
	}

	// --- Internal Helpers ---

	// ... (parseItemMetadata remains the same) ...
	private parseItemMetadata(rawExport: any): ZoteroItemMetadata | null {
		// ... (Keep existing implementation) ...
		// Simplified for brevity in this response, keep your previous full implementation
		let data = rawExport;
		if (typeof rawExport === 'string') try { data = JSON.parse(rawExport); } catch(e) { return null; }
		if (Array.isArray(data) && data.length > 2 && typeof data[2] === 'string') try { data = JSON.parse(data[2]); } catch(e) { return null; }
		const item = data.items ? data.items[0] : null;
		if (!item) return null;

		// ... (Parsing logic from previous turn) ...
		const creators = item.creators?.map((c: any) => c.name || `${c.firstName||''} ${c.lastName||''}`.trim()) || [];
		const pubName = item.publicationTitle || item.proceedingsTitle || item.conferenceName || "";

		return {
			key: item.key,
			itemType: item.itemType || "unknown",
			title: item.title || "",
			creators: creators,
			date: item.date || "",
			publication: pubName,
			doi: item.DOI || "",
			url: item.url || "",
			abstract: item.abstractNote || "",
			tags: item.tags?.map((t: any) => t.tag) || [],
			zoteroNotes: [], // (Keep your full parsing logic here)
			volume: item.volume, issue: item.issue, pages: item.pages, publisher: item.publisher
		};
	}

	private parseAnnotations(attachments: any[], citationKey: string): ZoteroAnnotation[] {
		const results: ZoteroAnnotation[] = [];
		for (const att of attachments) {
			let attachmentItemKey = att.itemKey;
			if (!attachmentItemKey && att.uri) {
				attachmentItemKey = att.uri.split('/').pop();
			}
			if (att.annotations && Array.isArray(att.annotations)) {
				for (const ann of att.annotations) {
					results.push({
						key: ann.key,
						citationKey: citationKey,
						type: this.mapAnnotationType(ann.annotationType),
						text: ann.annotationText || "",
						comment: ann.annotationComment || "",
						color: ann.annotationColor || "#aaaaaa",
						pageLabel: ann.annotationPageLabel || ann.page || "?",
						link: `zotero://open-pdf/library/items/${attachmentItemKey}?page=${ann.annotationPageLabel || 1}&annotation=${ann.key}`,
						attachmentTitle: att.title || "Unknown Attachment",
						// NEW: Capture Position for Image Matching
						position: ann.position // BBT provides { pageIndex: 0, rects: [...] }
					});
				}
			}
		}
		return results;
	}

	private mapAnnotationType(rawType: string): ZoteroAnnotation['type'] {
		if (rawType === 'highlight') return 'highlight';
		if (rawType === 'image') return 'image';
		if (rawType === 'ink') return 'ink';
		if (rawType === 'note') return 'note';
		return 'unknown';
	}

	// ... (resolveLibraryId, fetchLibraryMap, sendRpc remain the same) ...
	private async resolveLibraryId(citationKey: string): Promise<number> {
		const searchRes = await this.sendRpc('item.search', [citationKey]);
		if (!searchRes || searchRes.length === 0) throw new Error(`Citation Key '${citationKey}' not found.`);
		const firstHit = searchRes[0];
		const libraryName = (typeof firstHit === 'object' && firstHit.library) ? firstHit.library : "";
		const libs = await this.fetchLibraryMap();
		return libs[libraryName] || 1;
	}

	private async fetchLibraryMap(): Promise<Record<string, number>> {
		if (this.libraryCache) return this.libraryCache;
		const groups = await this.sendRpc('user.groups', []);
		this.libraryCache = { "": 1, "My Library": 1 };
		if (Array.isArray(groups)) {
			for (const g of groups) this.libraryCache[g.name] = g.id;
		}
		return this.libraryCache;
	}

	private async sendRpc(method: string, params: any[]): Promise<any> {
		try {
			const resp = await requestUrl({
				url: `http://127.0.0.1:${this.port}/better-bibtex/json-rpc`,
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', method, params })
			});
			if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
			const json = JSON.parse(resp.text);
			if (json.error) throw new Error(JSON.stringify(json.error));
			return json.result;
		} catch (e) {
			console.error("[ZoteroService] Error:", e);
			throw e;
		}
	}
}
