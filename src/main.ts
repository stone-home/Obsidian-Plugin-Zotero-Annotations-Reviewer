import { Plugin, Notice } from 'obsidian';
import { ZoteroSettingTab } from './settings';
import { HighlightModal } from './highlightModel';
import { InputModal } from './InputModal';

interface MyPluginSettings {
	zoteroPort: number;
	fleetingNoteFolder: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	zoteroPort: 23119,
	fleetingNoteFolder: 'Fleeting Notes'
}

export default class ZoteroGKPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// 命令: 手动输入 Citation Key
		this.addCommand({
			id: 'open-zotero-reviewer',
			name: 'Review Highlights (Enter Citation Key)',
			callback: () => {
				new InputModal(this.app, (key) => {
					if (key && key.trim().length > 0) {
						new HighlightModal(this.app, this.settings, key).open();
					}
				}).open();
			}
		});

		// 命令: 从当前笔记属性自动获取
		this.addCommand({
			id: 'review-current-note-highlights',
			name: 'Review Highlights (Current Note)',
			callback: () => {
				const file = this.app.workspace.getActiveFile();
				if(!file) return;

				const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
				// 支持 zotero-key 或 citation-key
				const key = fm?.['zotero-key'] || fm?.['citation-key'];

				if (key) {
					new HighlightModal(this.app, this.settings, key).open();
				} else {
					new Notice("No 'citation-key' found in frontmatter.");
				}
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
