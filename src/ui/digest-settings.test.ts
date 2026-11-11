import { Setting } from 'obsidian';
import { renderFormatHelp } from './digest-settings';
import { validateInput } from '../services/digest-import';

jest.mock('./digest-view', () => ({
	getDigestServices: jest.fn(),
	updateDigestRibbon: jest.fn(),
}));

function container(): HTMLElement {
	// The Obsidian mock adds createEl to elements it creates.
	return (new Setting(document.createElement('div')) as unknown as {
		settingEl: HTMLElement;
	}).settingEl;
}

describe('renderFormatHelp', () => {
	it('renders a collapsed JSONL section and a BibTeX section', () => {
		const el = container();
		renderFormatHelp(el);

		const sections = el.querySelectorAll('details.zotero-digest-format');
		expect(sections).toHaveLength(2);
		sections.forEach((section) => expect(section.hasAttribute('open')).toBe(false));
		expect(sections[0].querySelector('summary')?.textContent).toContain('JSONL');
		expect(sections[1].querySelector('summary')?.textContent).toContain('BibTeX');
	});

	it('lists every JSONL field with the two required ones marked', () => {
		const el = container();
		renderFormatHelp(el);

		const rows = Array.from(
			el.querySelectorAll('details')[0].querySelectorAll('tbody tr')
		).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent));
		expect(rows.map((r) => r[0])).toEqual([
			'key', 'title', 'doi', 'url', 'year', 'venue', 'abstract', 'item_type',
		]);
		expect(rows.filter((r) => r[1] === 'yes').map((r) => r[0])).toEqual(['key', 'title']);
	});

	it('shows an example line that passes the input check', () => {
		const el = container();
		renderFormatHelp(el);

		const example = el.querySelector('details pre code')?.textContent ?? '';
		expect(validateInput(JSON.parse(example)).ok).toBe(true);
	});

	it('lists the BibTeX fields the importer reads', () => {
		const el = container();
		renderFormatHelp(el);

		const fields = Array.from(
			el.querySelectorAll('details')[1].querySelectorAll('tbody tr td:first-child')
		).map((td) => td.textContent);
		expect(fields).toEqual([
			'doi',
			'eprint + archivePrefix (or eprinttype) = arXiv',
			'url',
			'title',
			'year',
			'journal or booktitle',
			'abstract',
			'entry type',
		]);
	});
});
