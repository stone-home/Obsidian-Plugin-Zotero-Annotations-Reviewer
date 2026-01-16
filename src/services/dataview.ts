import { App, Component } from 'obsidian';

export class DataviewService {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	get api(): any | undefined {
		const plugin = (this.app as any).plugins.getPlugin("dataview");
		if (plugin && plugin.settings) {
			// @ts-ignore
			return plugin.api;
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
		params: Record<string, any> = {}
	) {
		if (!this.api) {
			container.createDiv({ text: "Dataview API not available." });
			return;
		}

		try {
			// 1. Inject User Parameters Safely
			// We only stringify the 'params' object passed from the code block.
			// We DO NOT include 'app' or 'file' here to avoid circular structure errors.
			const codeWithParams = `const input = ${JSON.stringify(params)};\n\n${code}`;

			// 2. Execute
			await this.api.executeJs(
				codeWithParams,
				container,
				component,
				filePath
			);

		} catch (e) {
			console.error("Dataview Script Execution Error:", e);
			container.createDiv({
				text: `Script Error: ${(e as Error).message}`,
				cls: "zotero-text-error"
			});
		}
	}
}
