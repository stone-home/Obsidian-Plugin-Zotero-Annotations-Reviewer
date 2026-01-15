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

		new Setting(containerEl).setName('General').setHeading();

		new Setting(containerEl)
			.setName('Zotero Port')
			.setDesc('Port for Better BibTeX JSON-RPC (Default: 23119)')
			.addText(text => text
				.setValue(String(this.plugin.settings.zoteroPort))
				.onChange(async (value) => {
					this.plugin.settings.zoteroPort = Number(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Fleeting Notes Folder')
			.setDesc('Folder where atomic notes will be created')
			.addText(text => text
				.setValue(this.plugin.settings.fleetingNoteFolder)
				.onChange(async (value) => {
					this.plugin.settings.fleetingNoteFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName('Webhook Integration').setHeading();

		new Setting(containerEl)
			.setName('Webhook URL')
			.setDesc('URL to send note data to')
			.addText(text => text
				.setValue(this.plugin.settings.webhookUrl)
				.setPlaceholder('https://api.example.com/webhook')
				.onChange(async (value) => {
					this.plugin.settings.webhookUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable Condition (Regex)')
			.setDesc('Regex that must match the note content/frontmatter to enable the button. Leave empty to always enable. Example: "status:.*done" or "tags:.*finished"')
			.addText(text => text
				.setValue(this.plugin.settings.webhookCondition)
				.setPlaceholder('e.g. status: done')
				.onChange(async (value) => {
					this.plugin.settings.webhookCondition = value;
					await this.plugin.saveSettings();
				}));
	}
}
