import { Notice, Setting } from 'obsidian';
import type ZoteroGKPlugin from '../main';
import { DigestSettings, DigestVocabItem, toVocabId } from '../services/digest-types';
import { getDigestServices, updateDigestRibbon } from './digest-view';

const TEST_IDENTIFIER = '10.48550/arXiv.1706.03762';

/**
 * Renders the body of the Digest settings tab.
 * @param rerender redraws the tab after a structural change (row added or removed).
 */
export function renderDigestSettings(
	container: HTMLElement,
	plugin: ZoteroGKPlugin,
	rerender: () => void
): void {
	const svc = getDigestServices(plugin);
	const settings = svc.settings();
	const save = (patch: Partial<DigestSettings>) => svc.updateSettings(patch);

	new Setting(container)
		.setName('Translation server endpoint')
		.setDesc(
			'URL of the Zotero translation-server that resolves DOIs. ' +
				'Default is the local container.'
		)
		.addText((text) =>
			text
				.setPlaceholder('http://127.0.0.1:1969')
				.setValue(settings.translationServerUrl)
				.onChange((value) => save({ translationServerUrl: value.trim() }))
		)
		.addButton((button) =>
			button.setButtonText('Test').onClick(async () => {
				const result = await svc.translate.search(TEST_IDENTIFIER);
				new Notice(
					result.ok
						? `Translation server OK: "${String(result.item.title ?? '')}"`
						: `Translation server test failed: ${result.reason}`
				);
			})
		);

	new Setting(container)
		.setName('Incoming folder')
		.setDesc('Vault folder where external sources drop *.jsonl files.')
		.addText((text) =>
			text
				.setValue(settings.incomingFolder)
				.onChange((value) => save({ incomingFolder: value.trim() }))
		);
	renderFormatHelp(container);

	new Setting(container)
		.setName('Direction tag prefix')
		.setDesc('Written to Zotero as <prefix><direction id>.')
		.addText((text) =>
			text
				.setValue(settings.tagPrefix)
				.onChange((value) => save({ tagPrefix: value }))
		);

	new Setting(container)
		.setName('Retention (days)')
		.setDesc(
			'Accepted and rejected papers are removed from the store after this many days.'
		)
		.addText((text) =>
			text.setValue(String(settings.retentionDays)).onChange((value) => {
				const days = Number.parseInt(value, 10);
				if (Number.isInteger(days) && days >= 0)
					void save({ retentionDays: days });
			})
		);

	new Setting(container)
		.setName('Show Paper Digest icon in sidebar')
		.addToggle((toggle) =>
			toggle.setValue(settings.showInRibbon).onChange(async (value) => {
				await save({ showInRibbon: value });
				updateDigestRibbon(plugin);
			})
		);

	renderVocab(container, {
		title: 'Directions',
		description:
			'Fixed list offered when accepting a paper. Archived entries are hidden.',
		items: settings.directions,
		save: (items) => save({ directions: items }),
		rerender,
	});
	renderVocab(container, {
		title: 'Reject reasons',
		description: 'Fixed list offered when rejecting a paper.',
		items: settings.rejectReasons,
		save: (items) => save({ rejectReasons: items }),
		rerender,
	});
}

const JSONL_FIELDS: [field: string, required: string, value: string][] = [
	['key', 'yes', 'Non-empty string. Use the DOI, else the URL, else another stable id.'],
	['title', 'yes', 'Non-empty string.'],
	['doi', 'no', 'Bare DOI such as 10.1234/abc, without https://doi.org/.'],
	['url', 'no', 'Absolute http(s) URL.'],
	['year', 'no', 'Integer such as 2026, not the string "2026".'],
	['venue', 'no', 'String, e.g. OSDI.'],
	['abstract', 'no', 'String.'],
	['item_type', 'no', 'String shown on the card, e.g. conferencePaper or preprint.'],
];

const JSONL_EXAMPLE =
	'{"key":"10.48550/arXiv.2401.12345","title":"Paper title",' +
	'"doi":"10.48550/arXiv.2401.12345","url":"https://arxiv.org/abs/2401.12345",' +
	'"year":2024,"venue":"arXiv","abstract":"…","item_type":"preprint"}';

const BIB_FIELDS: [field: string, use: string][] = [
	['doi', 'DOI and key. A https://doi.org/ or doi: prefix is removed.'],
	[
		'eprint + archivePrefix (or eprinttype) = arXiv',
		'Used when doi or url is missing: DOI 10.48550/arXiv.<id> and URL https://arxiv.org/abs/<id>. A version suffix such as v2 is removed.',
	],
	['url', 'URL. Also the key when there is no DOI.'],
	['title', 'Title, with LaTeX markup removed. The citation key is used when it is empty.'],
	['year', 'Year, when it is a number.'],
	['journal or booktitle', 'Venue.'],
	['abstract', 'Abstract, with LaTeX markup removed.'],
	[
		'entry type',
		'Item type: article → journalArticle, inproceedings / conference → conferencePaper, ' +
			'book / proceedings → book, incollection / inbook → bookSection, ' +
			'phdthesis / mastersthesis → thesis, techreport → report, any other → document. ' +
			'arXiv entries become preprint.',
	],
];

function renderTable(parent: HTMLElement, head: string[], rows: string[][]): void {
	const table = parent.createEl('table', { cls: 'zotero-digest-format-table' });
	const headRow = table.createEl('thead').createEl('tr');
	head.forEach((text) => headRow.createEl('th', { text }));
	const body = table.createEl('tbody');
	rows.forEach((row) => {
		const tr = body.createEl('tr');
		row.forEach((text, i) => tr.createEl('td').createEl(i === 0 ? 'code' : 'span', { text }));
	});
}

/** Read-only reference for the two input formats: JSONL lines and BibTeX fields. */
export function renderFormatHelp(container: HTMLElement): void {
	const jsonl = container.createEl('details', { cls: 'zotero-digest-format' });
	jsonl.createEl('summary', { text: 'JSONL format for the incoming folder' });
	jsonl.createEl('p', {
		text:
			'One JSON object per line. Only *.jsonl files are read, so write to a .tmp file ' +
			'and rename it when it is complete. A file is removed after its lines are imported. ' +
			'Values are checked, never converted: a line that fails a check is listed under ' +
			'Invalid lines in the Paper Digest window. A line whose key or DOI matches a stored ' +
			'paper (ignoring case) is skipped as a duplicate.',
	});
	renderTable(jsonl, ['Field', 'Required', 'Value'], JSONL_FIELDS);
	jsonl.createEl('p', { text: 'Example line:' });
	jsonl.createEl('pre').createEl('code', { text: JSONL_EXAMPLE });

	const bib = container.createEl('details', { cls: 'zotero-digest-format' });
	bib.createEl('summary', { text: 'BibTeX fields for Import .bib' });
	bib.createEl('p', {
		text:
			'Import .bib is in the menu of the Paper Digest window. Each entry needs an ' +
			'identifier: doi, an arXiv eprint, or url. Entries without one are skipped, and ' +
			'@comment, @string and @preamble are ignored. Authors are not read from the file: ' +
			'they come from the DOI lookup when a paper is accepted.',
	});
	renderTable(bib, ['BibTeX field', 'Used as'], BIB_FIELDS);
}

type VocabEditor = {
	title: string;
	description: string;
	items: DigestVocabItem[];
	save: (items: DigestVocabItem[]) => Promise<void>;
	rerender: () => void;
};

function renderVocab(container: HTMLElement, editor: VocabEditor): void {
	const items = editor.items.map((item) => ({ ...item }));
	new Setting(container)
		.setName(editor.title)
		.setDesc(editor.description)
		.setHeading()
		.addButton((button) =>
			button.setButtonText('Add').onClick(async () => {
				await editor.save([...items, { id: '', label: '' }]);
				editor.rerender();
			})
		);

	items.forEach((item, index) => {
		new Setting(container)
			.addText((text) =>
				text
					.setPlaceholder('id (optional, from label)')
					.setValue(item.id)
					.onChange((value) => {
						item.id = toVocabId(value);
						void editor.save(items);
					})
			)
			.addText((text) =>
				text
					.setPlaceholder('Label')
					.setValue(item.label)
					.onChange((value) => {
						item.label = value;
						void editor.save(items);
					})
			)
			.addToggle((toggle) =>
				toggle
					.setTooltip('Archived')
					.setValue(item.archived === true)
					.onChange((value) => {
						item.archived = value;
						void editor.save(items);
					})
			)
			.addExtraButton((button) =>
				button
					.setIcon('trash')
					.setTooltip('Remove')
					.onClick(async () => {
						await editor.save(items.filter((_, i) => i !== index));
						editor.rerender();
					})
			);
	});
}
