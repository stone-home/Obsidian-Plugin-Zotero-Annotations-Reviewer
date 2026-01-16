import { Notice, App} from 'obsidian';
import { MyPluginSettings } from '../types';

export class ZoteroConnectorService {
	private settings: MyPluginSettings;
	private app: App

	constructor(app: App, setting: MyPluginSettings) {
		this.app = app
		this.settings = setting;
	}

	async triggerZoteroIntegrationImport(citationKey: string) {
		// @ts-ignore
		const plugin = this.app.plugins.getPlugin('obsidian-zotero-desktop-connector');
		if(plugin && plugin.settings.exportFormats) {
			const fmt = plugin.settings.exportFormats[0];
			if(fmt) await plugin.runImport(fmt.name, citationKey);
			console.error(citationKey)
			new Notice("Triggered Zotero Integration Import");
		} else {
			new Notice("Obsidian Zotero Desktop Connector plugin not found or configured.");
		}
	}

}
