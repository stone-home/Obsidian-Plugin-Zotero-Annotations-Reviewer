import { App, Modal, TFile } from 'obsidian';
import { CFPItem } from '../types';

export class CFPListModal extends Modal {
	constructor(
		app: App,
		private data: { upcoming: { item: CFPItem; path: string }[]; past: { item: CFPItem; path: string }[] }
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('zotero-cfp-list-modal');

		contentEl.createEl('h2', { text: 'Call For Papers' });

		const section = (title: string, entries: { item: CFPItem; path: string }[]) => {
			const block = contentEl.createDiv({ cls: 'zotero-cfp-list-section' });
			block.createEl('h3', { text: title });
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
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						this.app.workspace.getLeaf().openFile(file);
					}
					this.close();
				});
			}
		};

		section('Next deadlines', this.data.upcoming);
		section('Past deadlines', this.data.past);
	}
}
