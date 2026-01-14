declare module 'zotero-api-client' {
	/**
	 * Zotero API Factory Function
	 * @param apiKey API Key (本地模式传 undefined)
	 * @param config 配置对象 (用于覆盖默认的 api.zotero.org)
	 */
	export default function api(apiKey?: string, config?: ZoteroConfig): ZoteroClientInstance;

	interface ZoteroConfig {
		apiScheme?: string;        // e.g., 'http'
		apiAuthorityPart?: string; // e.g., '127.0.0.1:23119'
		[key: string]: any;
	}

	interface ZoteroClientInstance {
		library: (type: string, id: number) => LibraryInterface;
	}

	interface LibraryInterface {
		items: (itemKey?: string) => ItemsInterface;
	}

	interface ItemsInterface {
		children: () => ChildrenInterface;
		get: (params?: any) => Promise<ZoteroResponse>;
	}

	interface ChildrenInterface {
		get: () => Promise<ZoteroResponse>;
	}

	interface ZoteroResponse {
		getData: () => any[];
	}
}
