import { App, Notice, TFile } from 'obsidian';
import { DEFAULT_ZOTERO_TEMPLATE, MyPluginSettings } from '../types';
import { normalizePath } from '../utils/paths';

interface ZoteroExportFormat {
	name?: string;
	templatePath?: string;
	templateFile?: string;
}

interface ZoteroDesktopConnectorPlugin {
	settings?: {
		exportFormats?: ZoteroExportFormat[];
	};
	runImport?: (name: string, citekey: string) => Promise<void>;
}

export class ZoteroConnectorService {
	private settings: MyPluginSettings;
	private app: App;

	constructor(app: App, setting: MyPluginSettings) {
		this.app = app;
		this.settings = setting;
	}

	private getConnectorPlugin(): ZoteroDesktopConnectorPlugin | null {
		// @ts-ignore - Obsidian internal plugins registry
		const plugins = this.app.plugins;
		return plugins?.getPlugin?.('obsidian-zotero-desktop-connector') ?? null;
	}

	async triggerZoteroIntegrationImport(citationKey: string): Promise<void> {
		const plugin = this.getConnectorPlugin();
		const fmt = plugin?.settings?.exportFormats?.[0];
		if (plugin && fmt && fmt.name && plugin.runImport) {
			await plugin.runImport(fmt.name, String(citationKey));
			new Notice('Triggered Zotero Integration Import');
		} else {
			new Notice('Obsidian Zotero Desktop Connector plugin not found or configured.');
		}
	}

	detectTemplatePath(): string | null {
		const plugin = this.getConnectorPlugin();
		const fmt = plugin?.settings?.exportFormats?.[0];
		const raw = fmt?.templatePath || fmt?.templateFile;
		if (typeof raw === 'string' && raw.trim().length > 0) {
			return normalizePath(raw.trim());
		}
		return null;
	}

	async loadTemplateContent(
		explicitPath?: string
	): Promise<{ path: string | null; content: string; fromVault: boolean }> {
		const candidate =
			explicitPath?.trim() ||
			this.settings.zoteroTemplate?.vaultPath?.trim() ||
			this.detectTemplatePath();
		const resolvedPath = candidate ? normalizePath(candidate) : null;
		if (resolvedPath) {
			const existing = this.app.vault.getAbstractFileByPath(resolvedPath);
			if (existing instanceof TFile) {
				const content = await this.app.vault.read(existing);
				return { path: resolvedPath, content, fromVault: true };
			}
		}
		const fallback = this.settings.zoteroTemplate?.content || DEFAULT_ZOTERO_TEMPLATE;
		return { path: resolvedPath, content: fallback, fromVault: false };
	}

	async saveTemplateToVault(path: string, content: string): Promise<string> {
		const raw = path.trim();
		if (!raw) {
			throw new Error('Template vault path cannot be empty.');
		}
		const withExt = /\.[^/\\]+$/.test(raw) ? raw : `${raw}.md`;
		const normalized = normalizePath(withExt);

		const folders = normalized.split('/').slice(0, -1).filter(Boolean);
		let current = '';
		for (const segment of folders) {
			current = current ? `${current}/${segment}` : segment;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}

		const existing = this.app.vault.getAbstractFileByPath(normalized);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, content);
		} else {
			await this.app.vault.create(normalized, content);
		}
		return normalized;
	}
}
