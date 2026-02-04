import { App, Modal, Setting, ButtonComponent, Notice } from 'obsidian';
import { CFPItem } from '../types';

export class CFPManualModal extends Modal {
	onSubmit: (item: CFPItem) => void;
	private acronym = '';
	private fullName = '';
	private location = '';
	private start = '';
	private end = '';
	private submissionDdl = '';

	constructor(
		app: App,
		private defaultTags: string[],
		onSubmit: (item: CFPItem) => void
	) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('zotero-modal-wide');
		contentEl.createEl('h2', { text: 'Add manual CFP' });

		new Setting(contentEl)
			.setName('Acronym')
			.setDesc('Short name used as note filename (e.g. CHIL 2026).')
			.addText(t => t
				.setValue(this.acronym)
				.setPlaceholder('CHIL 2026')
				.onChange(v => this.acronym = v));

		new Setting(contentEl)
			.setName('Full name')
			.setDesc('Full conference or journal name.')
			.addText(t => t
				.setValue(this.fullName)
				.setPlaceholder('Conference on Health, Inference, and Learning')
				.onChange(v => this.fullName = v));

		new Setting(contentEl)
			.setName('Location')
			.setDesc('City, country or "N/A".')
			.addText(t => t
				.setValue(this.location)
				.setPlaceholder('Seattle, WA, USA')
				.onChange(v => this.location = v));

		new Setting(contentEl)
			.setName('Start date (optional)')
			.setDesc('e.g. Jun 28, 2026')
			.addText(t => t
				.setValue(this.start)
				.setPlaceholder('Jun 28, 2026')
				.onChange(v => this.start = v));

		new Setting(contentEl)
			.setName('End date (optional)')
			.setDesc('e.g. Jun 30, 2026')
			.addText(t => t
				.setValue(this.end)
				.setPlaceholder('Jun 30, 2026')
				.onChange(v => this.end = v));

		new Setting(contentEl)
			.setName('Submission deadline')
			.setDesc('Required for sorting (e.g. Feb 4, 2026).')
			.addText(t => t
				.setValue(this.submissionDdl)
				.setPlaceholder('Feb 4, 2026')
				.onChange(v => this.submissionDdl = v));

		const footer = contentEl.createDiv({ cls: 'zotero-modal-footer' });
		new ButtonComponent(footer).setButtonText('Cancel').onClick(() => this.close());
		new ButtonComponent(footer).setButtonText('Save').setCta().onClick(() => {
			const ac = this.acronym.trim();
			const name = this.fullName.trim();
			if (!ac && !name) {
				new Notice('Acronym or full name required.');
				return;
			}
			const item: CFPItem = {
				acronym: ac || name.slice(0, 30).replace(/\s+/g, '-'),
				fullName: name || ac,
				location: this.location.trim() || 'N/A',
				start: this.start.trim() || undefined,
				end: this.end.trim() || undefined,
				submissionDdl: this.submissionDdl.trim() || 'N/A',
				source: 'manual'
			};
			this.close();
			this.onSubmit(item);
		});
	}
}
