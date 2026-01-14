import { App, PluginSettingTab, Setting } from 'obsidian';
import ZoteroGKPlugin from './main';

export class ZoteroSettingTab extends PluginSettingTab {
	plugin: ZoteroGKPlugin;

	constructor(app: App, plugin: ZoteroGKPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// FIX: Changed contentEl to containerEl
		containerEl.createEl('h2', { text: 'Zotero Highlighter Settings' });

		new Setting(containerEl)
			.setName('Zotero Local API Port')
			.setDesc('The port Zotero is listening on. Default is 23119.')
			.addText(text => text
				.setPlaceholder('23119')
				.setValue(String(this.plugin.settings.zoteroPort))
				.onChange(async (value) => {
					const port = Number(value);
					if (!isNaN(port)) {
						this.plugin.settings.zoteroPort = port;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Fleeting Notes Folder')
			.setDesc('The folder where generated highlight notes will be stored.')
			.addText(text => text
				.setPlaceholder('Fleeting Notes')
				.setValue(this.plugin.settings.fleetingNoteFolder)
				.onChange(async (value) => {
					this.plugin.settings.fleetingNoteFolder = value;
					await this.plugin.saveSettings();
				}));
	}
}
