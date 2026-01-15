// src/services/ZoteroService.ts
import { requestUrl } from 'obsidian';
import { ZoteroAnnotation, ZoteroItemMetadata } from '../types';

export class ZoteroService {
	private port: number;
	private libraryCache: Record<string, number> | null = null;
	private readonly BBT_JSON_TRANSLATOR_ID = '36a3b0b5-bad0-4a04-b79b-441c7cef77db';

	constructor(port: number) {
		this.port = port;
	}

	// --- Public API ---

	async getRawMetadata(citationKey: string): Promise<any> {
		const libraryId = await this.resolveLibraryId(citationKey);
		console.log(`[ZoteroService] Fetching RAW metadata for ${citationKey}...`);
		return await this.sendRpc('item.export', [
			[citationKey],
			this.BBT_JSON_TRANSLATOR_ID,
			libraryId
		]);
	}

	async getItemMetadata(citationKey: string): Promise<ZoteroItemMetadata | null> {
		const libraryId = await this.resolveLibraryId(citationKey);
		const result = await this.sendRpc('item.export', [
			[citationKey],
			this.BBT_JSON_TRANSLATOR_ID,
			libraryId
		]);

		if (!result) return null;
		return this.parseItemMetadata(result);
	}

	async getAnnotations(citationKey: string): Promise<ZoteroAnnotation[]> {
		const libraryId = await this.resolveLibraryId(citationKey);
		const rawAttachments = await this.sendRpc('item.attachments', [
			citationKey,
			libraryId
		]);
		if (!rawAttachments) return [];
		return this.parseAnnotations(rawAttachments, citationKey);
	}

	// --- Internal Helpers ---

	private parseItemMetadata(rawExport: any): ZoteroItemMetadata | null {
		let data = rawExport;
		if (typeof rawExport === 'string') {
			try { data = JSON.parse(rawExport); } catch(e) { return null; }
		}
		// Handle legacy BBT array return format
		if (Array.isArray(data) && data.length > 2 && typeof data[2] === 'string') {
			try { data = JSON.parse(data[2]); } catch(e) { return null; }
		}

		const item = data.items ? data.items[0] : null;
		if (!item) return null;

		// 1. Parse Creators (Handle Authors vs Editors)
		const creators = item.creators?.map((c: any) => {
			const name = c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim();
			// Optional: Indicate if they are editors
			return c.creatorType === 'editor' ? `${name} (ed.)` : name;
		}) || [];

		// 2. Parse Notes (HTML stripping)
		const zoteroNotes = item.notes?.map((n: any) => {
			const rawHtml = n.note || "";
			// Remove tags for clean content
			const plainText = rawHtml.replace(/<[^>]+>/g, '').trim();

			// Try to find a title in the HTML (e.g. <h3>Title</h3> or <b>Title</b>)
			const titleMatch = rawHtml.match(/<h[1-6]>(.*?)<\/h[1-6]>/i) || rawHtml.match(/<b>(.*?)<\/b>/i);
			let title = titleMatch ? titleMatch[1] : plainText.slice(0, 50);

			// Clean up title (remove extra tags if nested)
			title = title.replace(/<[^>]+>/g, '').trim();
			if (title.length === 0) title = "Untitled Note";

			return {
				key: n.key,
				title: title,
				content: rawHtml,
				cleanContent: plainText
			};
		}) || [];

		// 3. Determine Publication Name based on Type
		let publication = item.publicationTitle || ""; // Journal
		if (item.itemType === 'bookSection') publication = item.bookTitle || "";
		if (item.itemType === 'conferencePaper') publication = item.proceedingsTitle || item.conferenceName || "";

		return {
			key: item.key,
			itemType: item.itemType || "unknown",
			title: item.title || "",
			creators: creators,
			date: item.date || "",
			publication: publication,
			volume: item.volume,
			issue: item.issue || item.number,
			pages: item.pages || "",
			publisher: item.publisher || "",
			place: item.place || "",
			series: item.series || item.seriesTitle || "",
			doi: item.DOI || "",
			url: item.url || "",
			abstract: item.abstractNote || "",
			tags: item.tags?.map((t: any) => t.tag) || [],
			zoteroNotes: zoteroNotes
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
						attachmentTitle: att.title || "Unknown Attachment"
					});
				}
			}
		}
		return results;
	}

	private mapAnnotationType(rawType: string): ZoteroAnnotation['type'] {
		if (rawType === 'highlight') return 'highlight';
		if (rawType === 'image') return 'image';
		if (rawType === 'ink') return 'image'; // Treat ink (drawings) as images
		if (rawType === 'note') return 'note';
		return 'unknown';
	}

	private async resolveLibraryId(citationKey: string): Promise<number> {
		const searchRes = await this.sendRpc('item.search', [citationKey]);
		if (!searchRes || searchRes.length === 0) {
			throw new Error(`Citation Key '${citationKey}' not found.`);
		}
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
