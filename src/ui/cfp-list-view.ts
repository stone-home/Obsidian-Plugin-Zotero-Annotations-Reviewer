import { MarkdownRenderChild, TFile } from 'obsidian';
import ZoteroGKPlugin from '../main';

export class CFPListView extends MarkdownRenderChild {
	constructor(containerEl: HTMLElement, private plugin: ZoteroGKPlugin) {
		super(containerEl);
	}

	async render() {
		const el = this.containerEl;
		el.empty();
		el.addClass('zotero-cfp-list-block');

		const data = await this.plugin.cfpService.getCFPNotesForDisplay();

		const section = (title: string, entries: { item: { acronym: string; fullName: string; location: string; submissionDdl: string }; path: string }[]) => {
			const block = el.createDiv({ cls: 'zotero-cfp-list-section' });
			block.createEl('h4', { text: title });
			if (entries.length === 0) {
				block.createDiv({ text: 'None', cls: 'zotero-cfp-list-empty' });
				return;
			}
			const list = block.createDiv({ cls: 'zotero-cfp-list' });
			for (const { item, path } of entries) {
				const row = list.createDiv({ cls: 'zotero-cfp-list-row' });
				row.createSpan({ cls: 'zotero-cfp-acronym', text: item.acronym });
				row.createSpan({ cls: 'zotero-cfp-ddl', text: item.submissionDdl });
				row.createSpan({ cls: 'zotero-cfp-name', text: item.fullName.slice(0, 50) + (item.fullName.length > 50 ? '…' : '') });
				row.createSpan({ cls: 'zotero-cfp-location', text: item.location });
				row.addEventListener('click', () => {
					const file = this.plugin.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						this.plugin.app.workspace.getLeaf().openFile(file);
					}
				});
			}
		};

		section('Next deadlines', data.upcoming);
		section('Past deadlines', data.past);
	}
}
