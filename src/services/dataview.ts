import { App, Component } from 'obsidian';

export interface DataviewApi {
	executeJs(
		code: string,
		container: HTMLElement,
		component: Component,
		filePath: string
	): Promise<void> | void;
}

interface DataviewPluginInstance {
	settings?: unknown;
	api?: DataviewApi;
}

interface AppWithPlugins {
	plugins?: {
		getPlugin?: (id: string) => unknown;
	};
}

export class DataviewService {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	get api(): DataviewApi | undefined {
		const rawPlugin = (this.app as unknown as AppWithPlugins).plugins?.getPlugin?.(
			'dataview'
		);
		if (typeof rawPlugin === 'object' && rawPlugin !== null) {
			const plugin = rawPlugin as DataviewPluginInstance;
			if (plugin.settings) {
				return plugin.api;
			}
		}
		return undefined;
	}

	get isAvailable(): boolean {
		return !!this.api;
	}

	/**
	 * Executes a DataviewJS script with injected 'input' parameters.
	 * @param code - The raw JavaScript code to execute.
	 * @param container - The HTMLElement to render into.
	 * @param component - The lifecycle owner (ctx).
	 * @param filePath - The path of the file being processed (for dv.current()).
	 * @param params - JSON-serializable parameters to inject as 'input'.
	 */
	async executeScript(
		code: string,
		container: HTMLElement,
		component: Component,
		filePath: string,
		params: Record<string, unknown> = {}
	): Promise<void> {
		const api = this.api;
		if (!api) {
			container.createDiv({ text: 'Dataview API not available.' });
			return;
		}

		try {
			// 1. Inject User Parameters Safely
			// We only stringify the 'params' object passed from the code block.
			// We DO NOT include 'app' or 'file' here to avoid circular structure errors.
			const codeWithParams = `const input = ${JSON.stringify(params)};\n\n${code}`;

			// 2. Execute
			await api.executeJs(codeWithParams, container, component, filePath);
		} catch (e) {
			console.error('Dataview Script Execution Error:', e);
			container.createDiv({
				text: `Script Error: ${(e as Error).message}`,
				cls: 'zotero-text-error',
			});
		}
	}
}
