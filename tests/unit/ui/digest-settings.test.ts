import ZoteroGKPlugin from '../../../src/main';
import { validateInput } from '../../../src/services/digest-import';
import {
	renderDigestSettings,
	renderFormatHelp,
} from '../../../src/ui/digest-settings';
import { getDigestServices } from '../../../src/ui/digest-view';
import {
	Platform,
	Plugin as MockPlugin,
	requestUrl,
	resetObsidianMocks,
} from '../../__mocks__/obsidian';
import { createTestPlugin } from '../../fixtures/plugin';
import { createTestApp, getNoticeMessages, TestAppHarness } from '../../fixtures/vault';

async function flushUi(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('renderFormatHelp', () => {
	beforeEach(() => {
		resetObsidianMocks();
	});

	it('renders a collapsed JSONL section and a BibTeX section', () => {
		const el = document.createElement('div');
		renderFormatHelp(el);

		const sections = el.querySelectorAll('details.zotero-digest-format');
		expect(sections).toHaveLength(2);
		sections.forEach((section) => expect(section.hasAttribute('open')).toBe(false));
		expect(sections[0].querySelector('summary')?.textContent).toContain('JSONL');
		expect(sections[1].querySelector('summary')?.textContent).toContain('BibTeX');
	});

	it('lists every JSONL field with the two required ones marked', () => {
		const el = document.createElement('div');
		renderFormatHelp(el);

		const rows = Array.from(
			el.querySelectorAll('details')[0].querySelectorAll('tbody tr')
		).map((tr) =>
			Array.from(tr.querySelectorAll('td')).map((td) => td.textContent)
		);
		expect(rows.map((r) => r[0])).toEqual([
			'key',
			'title',
			'doi',
			'url',
			'year',
			'venue',
			'abstract',
			'item_type',
		]);
		expect(rows.filter((r) => r[1] === 'yes').map((r) => r[0])).toEqual([
			'key',
			'title',
		]);
	});

	it('shows an example line that passes the input check', () => {
		const el = document.createElement('div');
		renderFormatHelp(el);

		const example = el.querySelector('details pre code')?.textContent ?? '';
		expect(validateInput(JSON.parse(example)).ok).toBe(true);
	});

	it('lists the BibTeX fields the importer reads', () => {
		const el = document.createElement('div');
		renderFormatHelp(el);

		const fields = Array.from(
			el
				.querySelectorAll('details')[1]
				.querySelectorAll('tbody tr td:first-child')
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

describe('renderDigestSettings', () => {
	let harness: TestAppHarness;
	let plugin: ZoteroGKPlugin;

	beforeEach(() => {
		resetObsidianMocks();
		Platform.isDesktopApp = true;
		harness = createTestApp();
		plugin = createTestPlugin(harness);
		plugin.saveSettings = jest.fn(async () => undefined);
	});

	it('updates endpoint, incoming folder, tag prefix, retention days, ribbon toggle, and tests translation server', async () => {
		const container = document.createElement('div');
		let rerenderCount = 0;
		const rerender = () => {
			rerenderCount++;
			container.empty();
			renderDigestSettings(container, plugin, rerender);
		};
		renderDigestSettings(container, plugin, rerender);

		const svc = getDigestServices(plugin);

		// Find top settings inputs: [0] endpoint, [1] incoming folder, [2] tag prefix, [3] retention days
		const textInputs = Array.from(
			container.querySelectorAll('.setting-item input[type="text"]')
		) as HTMLInputElement[];

		textInputs[0].value = '  http://127.0.0.1:2969  ';
		textInputs[0].dispatchEvent(new Event('input'));
		await flushUi();
		expect(svc.settings().translationServerUrl).toBe('http://127.0.0.1:2969');

		// Test button: success then failure
		const testBtn = Array.from(container.querySelectorAll('button')).find(
			(b) => b.textContent === 'Test'
		) as HTMLButtonElement;

		requestUrl.mockResolvedValueOnce({
			status: 200,
			headers: {},
			text: JSON.stringify([
				{ itemType: 'preprint', title: 'Attention Is All You Need' },
			]),
			json: [],
			arrayBuffer: new ArrayBuffer(0),
		});
		testBtn.click();
		await flushUi();
		expect(getNoticeMessages()).toContain(
			'Translation server OK: "Attention Is All You Need"'
		);

		requestUrl.mockRejectedValueOnce(new Error('ECONNREFUSED'));
		testBtn.click();
		await flushUi();
		expect(
			getNoticeMessages().some((m) =>
				m.includes('Translation server test failed:')
			)
		).toBe(true);

		// Incoming folder & tag prefix
		textInputs[1].value = '  Inbox/Digest  ';
		textInputs[1].dispatchEvent(new Event('input'));
		textInputs[2].value = 'topic/';
		textInputs[2].dispatchEvent(new Event('input'));
		await flushUi();
		expect(svc.settings().incomingFolder).toBe('Inbox/Digest');
		expect(svc.settings().tagPrefix).toBe('topic/');

		// Retention days: invalid ignored, valid integer saved
		textInputs[3].value = '-5';
		textInputs[3].dispatchEvent(new Event('input'));
		textInputs[3].value = 'abc';
		textInputs[3].dispatchEvent(new Event('input'));
		await flushUi();
		expect(svc.settings().retentionDays).toBe(30);

		textInputs[3].value = '45';
		textInputs[3].dispatchEvent(new Event('input'));
		await flushUi();
		expect(svc.settings().retentionDays).toBe(45);

		// Ribbon toggle calls updateDigestRibbon
		const ribbonToggle = container.querySelector(
			'.setting-item input[type="checkbox"]'
		) as HTMLInputElement;
		ribbonToggle.checked = false;
		ribbonToggle.dispatchEvent(new Event('change'));
		await flushUi();
		expect(svc.settings().showInRibbon).toBe(false);

		ribbonToggle.checked = true;
		ribbonToggle.dispatchEvent(new Event('change'));
		await flushUi();
		expect(svc.settings().showInRibbon).toBe(true);
		expect((plugin as unknown as MockPlugin).ribbonIcons.length).toBeGreaterThan(0);
		expect(rerenderCount).toBe(0);
	});

	it('manages Directions and Reject reasons vocabulary rows (Add, id normalization, label, archive toggle, Remove)', async () => {
		const container = document.createElement('div');
		let rerenderCount = 0;
		const rerender = () => {
			rerenderCount++;
			container.empty();
			renderDigestSettings(container, plugin, rerender);
		};
		renderDigestSettings(container, plugin, rerender);

		const svc = getDigestServices(plugin);
		expect(svc.settings().directions).toEqual([]);

		// Click "Add" on Directions (first "Add" button)
		const addButtons = Array.from(container.querySelectorAll('button')).filter(
			(b) => b.textContent === 'Add'
		) as HTMLButtonElement[];
		expect(addButtons).toHaveLength(2);
		addButtons[0].click();
		await flushUi();

		expect(rerenderCount).toBe(1);
		expect(svc.settings().directions).toEqual([{ id: '', label: '' }]);

		// Edit newly added Direction row (inputs 4 and 5 after the 4 top text inputs)
		const allTextInputs = Array.from(
			container.querySelectorAll('.setting-item input[type="text"]')
		) as HTMLInputElement[];
		const dirIdInput = allTextInputs[4];
		const dirLabelInput = allTextInputs[5];

		dirIdInput.value = '  GPU / Kernel! ';
		dirIdInput.dispatchEvent(new Event('input'));
		dirLabelInput.value = 'GPU & Kernels';
		dirLabelInput.dispatchEvent(new Event('input'));
		await flushUi();

		expect(svc.settings().directions[0]).toMatchObject({
			id: 'gpu-kernel',
			label: 'GPU & Kernels',
		});

		// Toggle archived on Direction row (second checkbox in container; first is Show in sidebar)
		const checkboxes = Array.from(
			container.querySelectorAll('.setting-item input[type="checkbox"]')
		) as HTMLInputElement[];
		checkboxes[1].checked = true;
		checkboxes[1].dispatchEvent(new Event('change'));
		await flushUi();
		expect(svc.settings().directions[0].archived).toBe(true);

		// Remove Direction row via trash extra button
		const removeButtons = Array.from(
			container.querySelectorAll('.extra-setting-button[aria-label="Remove"]')
		) as HTMLElement[];
		removeButtons[0].click();
		await flushUi();

		expect(rerenderCount).toBe(2);
		expect(svc.settings().directions).toEqual([]);
	});
});
