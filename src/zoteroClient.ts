import { requestUrl, Notice } from 'obsidian';

const BBT_JSON_TRANSLATOR_ID = '36a3b0b5-bad0-4a04-b79b-441c7cef77db';

export class ZoteroClient {
	port: number;
	libraryCache: Record<string, number> | null = null; // 缓存库信息 { "My Library": 1, ... }

	constructor(port: number = 23119) {
		this.port = port;
	}

	async sendRpcRequest(method: string, params: any[]) {
		try {
			console.log(`[ZoteroClient] RPC Request: ${method}`, params);

			const response = await requestUrl({
				url: `http://127.0.0.1:${this.port}/better-bibtex/json-rpc`,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Accept': 'application/json'
				},
				body: JSON.stringify({
					jsonrpc: '2.0',
					method: method,
					params: params
				})
			});

			if (response.status !== 200) {
				throw new Error(`RPC Error ${response.status}: ${response.text}`);
			}

			const json = JSON.parse(response.text);
			if (json.error) {
				const msg = typeof json.error === 'object' ? JSON.stringify(json.error) : json.error;
				throw new Error(`BBT Error: ${msg}`);
			}

			return json.result;
		} catch (error) {
			console.error("[ZoteroClient] RPC Failed:", error);
			throw error;
		}
	}

	/**
	 * 1. 获取所有库的信息 (ID 和 Name)
	 */
	async fetchLibraries() {
		if (this.libraryCache) return this.libraryCache;

		// user.groups 返回所有可用的库
		const groups = await this.sendRpcRequest('user.groups', []);
		this.libraryCache = {};

		if (Array.isArray(groups)) {
			for (const g of groups) {
				this.libraryCache[g.name] = g.id;
			}
		}

		console.log("[ZoteroClient] Loaded Libraries:", this.libraryCache);
		return this.libraryCache;
	}

	async getHighlights(citationKey: string) {
		// Step 1: 确定 Library ID
		const libs = await this.fetchLibraries();

		// 验证 Citation Key 并获取其所属库
		const searchResults = await this.sendRpcRequest('item.search', [citationKey]);
		if (!searchResults || searchResults.length === 0) {
			throw new Error(`Citation Key "${citationKey}" not found.`);
		}

		const match = searchResults[0];
		const libraryName = match.library || "My Library";
		const libraryId = (libs && libs[libraryName]) ? libs[libraryName] : 1;

		console.log(`[ZoteroClient] Fetching attachments for ${citationKey} in Library ${libraryId}`);

		// Step 2: 使用 item.attachments 获取标注
		// 这是 mgmeyers 插件获取标注的核心方法
		// Params: [ citationKey, libraryID ]
		const attachmentResult = await this.sendRpcRequest('item.attachments', [
			citationKey,
			libraryId
		]);

		console.log("[ZoteroClient] Attachments Raw:", attachmentResult);

		if (!attachmentResult) return [];

		// Step 3: 提取 Annotations
		const annotations: any[] = [];

		for (const att of attachmentResult) {
			// 解析附件的 ItemKey (用于构建链接)
			// att.uri 格式通常是 "http://zotero.org/users/xxx/items/ABCD1234"
			let attachmentItemKey = att.itemKey;
			if (!attachmentItemKey && att.uri) {
				attachmentItemKey = att.uri.split('/').pop();
			}

			if (att.annotations && Array.isArray(att.annotations)) {
				for (const ann of att.annotations) {
					annotations.push({
						key: ann.key,
						text: ann.text || "[Image/No Text]",
						comment: ann.comment || "",
						color: ann.color || "#aaaaaa",
						pageLabel: ann.pageLabel || ann.page || "?",
						// 构建跳转链接: zotero://open-pdf/library/items/{itemKey}?page={page}&annotation={key}
						link: `zotero://open-pdf/library/items/${attachmentItemKey}?page=${ann.page || 1}&annotation=${ann.key}`,
						attachmentTitle: att.title
					});
				}
			}
		}

		console.log(`[ZoteroClient] Processed ${annotations.length} annotations.`);
		return annotations;
	}
}
