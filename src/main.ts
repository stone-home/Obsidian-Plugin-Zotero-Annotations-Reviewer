import { Plugin, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings } from './types';
import { ZoteroSettingTab } from './settings';
import { HighlightModal } from './ui/highlights';
import { InputModal } from './ui/inputs'; // Reuse your existing InputModal

export default class ZoteroGKPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// Command: Review Highlights (Manual)
		this.addCommand({
			id: 'zotero-review-manual',
			name: 'Review Highlights (Enter Citation Key)',
			callback: () => {
				new InputModal(this.app, (key) => {
					if (key) new HighlightModal(this.app, this.settings, key).open();
				}).open();
			}
		});

		this.addSettingTab(new ZoteroSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
