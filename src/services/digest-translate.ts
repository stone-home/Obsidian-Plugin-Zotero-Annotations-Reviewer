import { DigestHttp } from './digest-types';

/** An item in Zotero API JSON, as returned by translation-server. */
export type ZoteroItemJson = Record<string, unknown> & { itemType: string };

/** Outcome of an identifier lookup. */
export type TranslationLookup =
	| { ok: true; item: ZoteroItemJson }
	| { ok: false; reason: string; unreachable?: boolean };

const CHILD_ITEM_TYPES = new Set(['note', 'attachment', 'annotation']);

/**
 * Client of a Zotero translation-server, which resolves an identifier (DOI,
 * arXiv id, ISBN, PMID) to item metadata with Zotero's own translators.
 */
export class TranslationClient {
	constructor(
		private readonly http: DigestHttp,
		private readonly getBaseUrl: () => string
	) {}

	private endpoint(path: string): string {
		return this.getBaseUrl().trim().replace(/\/+$/, '') + path;
	}

	/** True when the server answers at all, whatever the HTTP status. */
	async ping(): Promise<boolean> {
		try {
			await this.http({ url: this.endpoint('/'), method: 'GET' });
			return true;
		} catch {
			return false;
		}
	}

	/** Resolves an identifier to the first top-level item the server returns. */
	async search(identifier: string): Promise<TranslationLookup> {
		let response;
		try {
			response = await this.http({
				url: this.endpoint('/search'),
				method: 'POST',
				contentType: 'text/plain',
				headers: { 'Content-Type': 'text/plain' },
				body: identifier,
			});
		} catch (e) {
			return {
				ok: false,
				unreachable: true,
				reason: `Translation server not reachable: ${(e as Error).message}`,
			};
		}
		if (response.status === 300) {
			return { ok: false, reason: 'Lookup returned several candidates' };
		}
		if (response.status === 501) {
			return { ok: false, reason: `Lookup found nothing for ${identifier}` };
		}
		if (response.status !== 200) {
			return {
				ok: false,
				reason: `Lookup failed (HTTP ${response.status}) for ${identifier}`,
			};
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(response.text);
		} catch {
			return { ok: false, reason: 'Lookup returned a response that is not JSON' };
		}
		const items = Array.isArray(parsed) ? parsed : [];
		const item = items.find(
			(candidate): candidate is ZoteroItemJson =>
				typeof candidate === 'object' &&
				candidate !== null &&
				typeof candidate.itemType === 'string' &&
				!CHILD_ITEM_TYPES.has(candidate.itemType)
		);
		if (!item)
			return { ok: false, reason: `Lookup found nothing for ${identifier}` };
		return { ok: true, item };
	}
}
