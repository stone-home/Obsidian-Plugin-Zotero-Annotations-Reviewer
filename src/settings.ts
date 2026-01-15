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

		new Setting(containerEl)
			.setName('Zotero Port')
			.addText(text => text
				.setValue(String(this.plugin.settings.zoteroPort))
				.onChange(async (value) => {
					this.plugin.settings.zoteroPort = Number(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Fleeting Notes Folder')
			.addText(text => text
				.setValue(this.plugin.settings.fleetingNoteFolder)
				.onChange(async (value) => {
					this.plugin.settings.fleetingNoteFolder = value;
					await this.plugin.saveSettings();
				}));
	}
}
