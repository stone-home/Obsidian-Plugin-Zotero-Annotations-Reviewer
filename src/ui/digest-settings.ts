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
