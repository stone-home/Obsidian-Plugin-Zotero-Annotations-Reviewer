import { Modal } from 'obsidian';
import ZoteroGKPlugin from '../../../src/main';
import {
	IconSuggestModal,
	WebhookEditModal,
	ZoteroSettingTab,
} from '../../../src/settings';
import {
	DEFAULT_ASSISTANT_SCRIPT,
	DEFAULT_PAPER_WORKSPACE,
	DEFAULT_REPORT1_NOTE_TEMPLATE,
	DEFAULT_SYNTHESIZE_PROMPT,
	DEFAULT_ZOTERO_TEMPLATE,
	WebhookProfile,
} from '../../../src/types';
import { CFPManualModal } from '../../../src/ui/cfp-manual-modal';
import { requestUrl, resetObsidianMocks } from '../../__mocks__/obsidian';
import { createTestPlugin } from '../../fixtures/plugin';
import {
	clearNotices,
	clearOpenedModals,
	createTestApp,
	getLastOpenedModal,
	getNoticeMessages,
	TestAppHarness,
} from '../../fixtures/vault';

async function flushUi(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function clickTab(tab: ZoteroSettingTab, label: string): void {
	const item = Array.from(tab.containerEl.querySelectorAll('.zotero-tab-item')).find(
		(el) => el.textContent?.trim() === label
	) as HTMLElement | undefined;
	if (!item) throw new Error(`Tab "${label}" not found`);
	item.click();
}

function findSettingByName(root: HTMLElement, name: string): HTMLElement {
	const found = Array.from(root.querySelectorAll('.setting-item')).find(
		(el) => el.querySelector('.setting-item-name')?.textContent?.trim() === name
	) as HTMLElement | undefined;
	if (!found) throw new Error(`Setting "${name}" not found`);
	return found;
}

describe('ZoteroSettingTab, WebhookEditModal, and IconSuggestModal', () => {
	let harness: TestAppHarness;
	let plugin: ZoteroGKPlugin;
	let settingTab: ZoteroSettingTab;
	let warnSpy: jest.SpyInstance;
	let errorSpy: jest.SpyInstance;

	beforeEach(() => {
		resetObsidianMocks();
		harness = createTestApp();
		plugin = createTestPlugin(harness);
		plugin.saveSettings = jest.fn(async () => undefined);
		settingTab = new ZoteroSettingTab(harness.app, plugin);
		warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
		errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: jest.fn(async () => undefined) },
			configurable: true,
		});
	});

	afterEach(() => {
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it('renders General tab, syncs Highlight Notes and Fleeting Notes Folder bidirectionally, resets workspace rows, and updates Zotero/Project settings', async () => {
		settingTab.display();

		const tabLabels = Array.from(
			settingTab.containerEl.querySelectorAll('.zotero-tab-item')
		).map((t) => t.textContent?.trim());
		expect(tabLabels).toEqual([
			'General',
			'Highlights',
			'Templates',
			'Webhooks',
			'CFP',
			'Digest',
		]);

		// Edit Takeaway label & path, then click its reset button
		const takeawaySetting = findSettingByName(settingTab.containerEl, 'Takeaway');
		const takeawayInputs = Array.from(
			takeawaySetting.querySelectorAll('input')
		) as HTMLInputElement[];
		takeawayInputs[0].value = 'Synthesis';
		takeawayInputs[0].dispatchEvent(new Event('input'));
		takeawayInputs[1].value = 'Custom/Takeaways/{{citekey}}.md';
		takeawayInputs[1].dispatchEvent(new Event('input'));
		await flushUi();
		expect(plugin.settings.paperWorkspace.takeawayLabel).toBe('Synthesis');
		expect(plugin.settings.paperWorkspace.takeawayPath).toBe(
			'Custom/Takeaways/{{citekey}}.md'
		);

		const resetTakeawayBtn = takeawaySetting.querySelector(
			'.extra-setting-button'
		) as HTMLElement;
		resetTakeawayBtn.click();
		await flushUi();
		expect(plugin.settings.paperWorkspace.takeawayLabel).toBe(
			DEFAULT_PAPER_WORKSPACE.takeawayLabel
		);
		expect(plugin.settings.paperWorkspace.takeawayPath).toBe(
			DEFAULT_PAPER_WORKSPACE.takeawayPath
		);

		// Bidirectional sync: Highlight Notes (Fleeting) <-> Fleeting Notes Folder
		const hlSetting = findSettingByName(
			settingTab.containerEl,
			'Highlight Notes (Fleeting)'
		);
		const flSetting = findSettingByName(
			settingTab.containerEl,
			'Fleeting Notes Folder'
		);
		const hlInput = hlSetting.querySelector('input') as HTMLInputElement;
		const flInput = flSetting.querySelector('input') as HTMLInputElement;

		hlInput.value = '001-CustomFleeting';
		hlInput.dispatchEvent(new Event('input'));
		await flushUi();
		expect(plugin.settings.fleetingNoteFolder).toBe('001-CustomFleeting');
		expect(flInput.value).toBe('001-CustomFleeting');

		flInput.value = '001-SyncedBack';
		flInput.dispatchEvent(new Event('input'));
		await flushUi();
		expect(plugin.settings.paperWorkspace.highlightNotesFolder).toBe(
			'001-SyncedBack'
		);
		expect(hlInput.value).toBe('001-SyncedBack');

		// Zotero Port, Citation Key, Annotation Key, Project Linker inputs
		const portInput = findSettingByName(
			settingTab.containerEl,
			'Zotero Port'
		).querySelector('input') as HTMLInputElement;
		portInput.value = '24119';
		portInput.dispatchEvent(new Event('input'));
		await flushUi();
		expect(plugin.settings.zoteroPort).toBe(24119);

		const citeInput = findSettingByName(
			settingTab.containerEl,
			'Citation Key Name'
		).querySelector('input') as HTMLInputElement;
		citeInput.value = '   ';
		citeInput.dispatchEvent(new Event('input'));
		const annInput = findSettingByName(
			settingTab.containerEl,
			'Annotation Key Name'
		).querySelector('input') as HTMLInputElement;
		annInput.value = '   ';
		annInput.dispatchEvent(new Event('input'));
		await flushUi();
		expect(plugin.settings.citationKeyName).toBe('citation-key');
		expect(plugin.settings.annotationKeyName).toBe('annotation-id');

		const projFolderInput = findSettingByName(
			settingTab.containerEl,
			'Projects Folder'
		).querySelector('input') as HTMLInputElement;
		projFolderInput.value = '004-Projects';
		projFolderInput.dispatchEvent(new Event('input'));
		const projFmInput = findSettingByName(
			settingTab.containerEl,
			'Project Frontmatter Key'
		).querySelector('input') as HTMLInputElement;
		projFmInput.value = 'linked_projects';
		projFmInput.dispatchEvent(new Event('input'));
		const projIdInput = findSettingByName(
			settingTab.containerEl,
			'Project ID Key'
		).querySelector('input') as HTMLInputElement;
		projIdInput.value = 'proj_code';
		projIdInput.dispatchEvent(new Event('input'));
		await flushUi();

		expect(plugin.settings.projectsFolder).toBe('004-Projects');
		expect(plugin.settings.projectFrontmatterKey).toBe('linked_projects');
		expect(plugin.settings.projectIdKey).toBe('proj_code');
	});

	it('renders Highlights tab: sort dropdown, metadata mapping CRUD, legacy DataviewJS toggle, Reset Script, and CodeMirror', async () => {
		settingTab.display();
		clickTab(settingTab, 'Highlights');

		const sortSelect = findSettingByName(
			settingTab.containerEl,
			'Default Annotation Sort'
		).querySelector('select') as HTMLSelectElement;
		sortSelect.value = 'pageLabel';
		sortSelect.dispatchEvent(new Event('change'));
		await flushUi();
		expect(plugin.settings.sortProperty).toBe('pageLabel');

		// Metadata mapping: edit first row, add property, delete last row
		const initialCount = plugin.settings.metadataMapping.length;
		const firstBlock = settingTab.containerEl.querySelector(
			'.zotero-setting-block'
		) as HTMLElement;
		const firstToggle = firstBlock.querySelector(
			'input[type="checkbox"]'
		) as HTMLInputElement;
		firstToggle.checked = false;
		firstToggle.dispatchEvent(new Event('change'));
		const firstTexts = Array.from(
			firstBlock.querySelectorAll('input[type="text"]')
		) as HTMLInputElement[];
		firstTexts[0].value = 'Paper Title';
		firstTexts[0].dispatchEvent(new Event('input'));
		firstTexts[1].value = 'title';
		firstTexts[1].dispatchEvent(new Event('input'));
		firstTexts[2].value = 'paper_title';
		firstTexts[2].dispatchEvent(new Event('input'));
		await flushUi();
		expect(plugin.settings.metadataMapping[0]).toEqual({
			label: 'Paper Title',
			zoteroProp: 'title',
			noteProp: 'paper_title',
			enabled: false,
		});

		const addPropBtn = Array.from(
			settingTab.containerEl.querySelectorAll('button')
		).find((b) => b.textContent === '+ Add Property') as HTMLButtonElement;
		addPropBtn.click();
		await flushUi();
		expect(plugin.settings.metadataMapping).toHaveLength(initialCount + 1);

		const blocksAfterAdd = Array.from(
			settingTab.containerEl.querySelectorAll('.zotero-setting-block')
		);
		const lastDeleteBtn = blocksAfterAdd[blocksAfterAdd.length - 1].querySelector(
			'button'
		) as HTMLButtonElement;
		lastDeleteBtn.click();
		await flushUi();
		expect(plugin.settings.metadataMapping).toHaveLength(initialCount);

		// Legacy DataviewJS toggle & Reset Script
		plugin.settings.assistantScript = '// modified';
		const legacyToggle = findSettingByName(
			settingTab.containerEl,
			'Enable legacy DataviewJS section in Assistant'
		).querySelector('input[type="checkbox"]') as HTMLInputElement;
		legacyToggle.checked = true;
		legacyToggle.dispatchEvent(new Event('change'));
		await flushUi();
		expect(plugin.settings.enableLegacyAssistantScript).toBe(true);

		const resetScriptBtn = Array.from(
			settingTab.containerEl.querySelectorAll('button')
		).find((b) => b.textContent === 'Reset Script') as HTMLButtonElement;
		resetScriptBtn.click();
		await flushUi();
		expect(plugin.settings.assistantScript).toBe(DEFAULT_ASSISTANT_SCRIPT);
		expect(settingTab.containerEl.querySelector('.cm-editor')).not.toBeNull();
	});

	it('renders Templates tab: Sync Missing Defaults, Move Folder, Detect/Open/Snapshot/Restore/Reset templates, and Add/Copy/Delete custom prompts', async () => {
		settingTab.display();
		clickTab(settingTab, 'Templates');

		// 1. Sync Missing Defaults creates all 9 files; second click reports already exist
		const findBtn = (label: string) =>
			Array.from(settingTab.containerEl.querySelectorAll('button')).find(
				(b) => b.textContent === label
			) as HTMLButtonElement;

		findBtn('Sync Missing Defaults').click();
		await flushUi();
		expect(getNoticeMessages()).toContain(
			'Created 9 missing default files in Vault.'
		);

		clearNotices();
		findBtn('Sync Missing Defaults').click();
		await flushUi();
		expect(getNoticeMessages()).toContain(
			'All built-in templates and prompts already exist in Vault.'
		);

		// 2. Move Folder relocates files to 950-Templates
		const folderInput = settingTab.containerEl.querySelector(
			'.zotero-template-folder-row input'
		) as HTMLInputElement;
		folderInput.value = '950-Templates';
		folderInput.dispatchEvent(new Event('input'));
		findBtn('Move Folder').click();
		await flushUi();
		expect(plugin.settings.paperWorkspace.templatesFolder).toBe('950-Templates');
		expect(harness.getFile('950-Templates/zotero-note-template.md')).not.toBeNull();

		// 3. Zotero Note Template row: Detect (missing then present), Open, Snapshot, Restore, Reset
		const getZoteroRow = () =>
			settingTab.containerEl.querySelectorAll(
				'.zotero-template-file-row'
			)[0] as HTMLElement;
		const rowBtn = (row: HTMLElement, text: string) =>
			Array.from(row.querySelectorAll('button')).find(
				(b) => b.textContent === text
			) as HTMLButtonElement;

		clearNotices();
		rowBtn(getZoteroRow(), 'Detect').click();
		await flushUi();
		expect(getNoticeMessages()).toContain(
			'Could not auto-detect template path from Zotero Integration.'
		);

		harness.registerPlugin('obsidian-zotero-desktop-connector', {
			settings: {
				exportFormats: [
					{ templatePath: '950-Templates/zotero-note-template.md' },
				],
			},
		});
		rowBtn(getZoteroRow(), 'Detect').click();
		await flushUi();
		expect(getNoticeMessages()).toContain(
			'Detected Zotero template: 950-Templates/zotero-note-template.md'
		);

		rowBtn(getZoteroRow(), 'Open').click();
		await flushUi();
		expect(harness.mockApp.setting?.close).toHaveBeenCalled();

		harness.setContent(
			'950-Templates/zotero-note-template.md',
			'# Snapshotted Zotero Template'
		);
		rowBtn(getZoteroRow(), 'Snapshot').click();
		await flushUi();
		expect(plugin.settings.zoteroTemplate.snapshot).toBe(
			'# Snapshotted Zotero Template'
		);

		// Reset -> ConfirmActionModal -> Reset back to DEFAULT_ZOTERO_TEMPLATE
		clearOpenedModals();
		rowBtn(getZoteroRow(), 'Reset').click();
		const resetZotModal = getLastOpenedModal<Modal>()!;
		rowBtn(resetZotModal.contentEl, 'Reset').click();
		await flushUi();
		expect(harness.getContent('950-Templates/zotero-note-template.md')).toBe(
			DEFAULT_ZOTERO_TEMPLATE
		);

		// Restore -> ConfirmActionModal -> Restore back to snapshot
		clearOpenedModals();
		rowBtn(getZoteroRow(), 'Restore').click();
		const restoreZotModal = getLastOpenedModal<Modal>()!;
		rowBtn(restoreZotModal.contentEl, 'Restore').click();
		await flushUi();
		expect(harness.getContent('950-Templates/zotero-note-template.md')).toBe(
			'# Snapshotted Zotero Template'
		);

		// 4. Built-in Note Template (tpl-report1, row index 1): Snapshot + Reset + Restore
		const getReport1TplRow = () =>
			settingTab.containerEl.querySelectorAll(
				'.zotero-template-file-row'
			)[1] as HTMLElement;
		harness.setContent(
			'950-Templates/report1-note-template.md',
			'---\ntype: custom-r1\n---'
		);
		rowBtn(getReport1TplRow(), 'Snapshot').click();
		await flushUi();

		clearOpenedModals();
		rowBtn(getReport1TplRow(), 'Reset').click();
		rowBtn(getLastOpenedModal<Modal>()!.contentEl, 'Reset').click();
		await flushUi();
		expect(harness.getContent('950-Templates/report1-note-template.md')).toBe(
			DEFAULT_REPORT1_NOTE_TEMPLATE
		);

		clearOpenedModals();
		rowBtn(getReport1TplRow(), 'Restore').click();
		rowBtn(getLastOpenedModal<Modal>()!.contentEl, 'Restore').click();
		await flushUi();
		expect(harness.getContent('950-Templates/report1-note-template.md')).toBe(
			'---\ntype: custom-r1\n---'
		);

		// 5. Prompts card: placeholder chip copy, Copy prompt, Snapshot/Reset/Restore on built-in, and + Add Prompt / Delete custom prompt
		const chipBtn = settingTab.containerEl.querySelector(
			'.zotero-placeholder-chip'
		) as HTMLButtonElement;
		chipBtn.click();
		await flushUi();
		expect(getNoticeMessages()).toContain('Copied {{prompt.synthesize}}');

		const getSynthRow = () =>
			Array.from(
				settingTab.containerEl.querySelectorAll('.zotero-template-file-row')
			).find((r) =>
				r.textContent?.includes('{{prompt.synthesize}}')
			) as HTMLElement;

		rowBtn(getSynthRow(), 'Copy').click();
		await flushUi();
		expect(
			getNoticeMessages().some((m) => m.includes('prompt to clipboard.'))
		).toBe(true);

		rowBtn(getSynthRow(), 'Snapshot').click();
		await flushUi();
		clearOpenedModals();
		rowBtn(getSynthRow(), 'Reset').click();
		rowBtn(getLastOpenedModal<Modal>()!.contentEl, 'Reset').click();
		await flushUi();
		expect(harness.getContent('950-Templates/prompt-synthesize.md')).toBe(
			DEFAULT_SYNTHESIZE_PROMPT
		);

		// + Add Prompt -> validation, duplicate check, then create & Delete
		clearOpenedModals();
		findBtn('+ Add Prompt').click();
		const addModal = getLastOpenedModal<Modal>()!;
		const addInputs = Array.from(
			addModal.contentEl.querySelectorAll('input')
		) as HTMLInputElement[];

		// Empty validation
		rowBtn(addModal.contentEl, 'Create Prompt').click();
		await flushUi();
		expect(getNoticeMessages()).toContain(
			'Please enter a valid prompt name and ID.'
		);

		// Duplicate ID check
		addInputs[0].value = 'Synthesize';
		addInputs[0].dispatchEvent(new Event('input'));
		expect(addInputs[1].value).toBe('synthesize');
		rowBtn(addModal.contentEl, 'Create Prompt').click();
		await flushUi();
		expect(getNoticeMessages()).toContain('Prompt ID "synthesize" already exists.');

		// Valid custom prompt creation
		addInputs[0].value = 'Related Work Audit';
		addInputs[0].dispatchEvent(new Event('input'));
		expect(addInputs[1].value).toBe('related_work_audit');
		rowBtn(addModal.contentEl, 'Create Prompt').click();
		await flushUi();

		expect(plugin.settings.prompts.some((p) => p.id === 'related_work_audit')).toBe(
			true
		);
		const customRow = Array.from(
			settingTab.containerEl.querySelectorAll('.zotero-template-file-row')
		).find((r) =>
			r.textContent?.includes('{{prompt.related_work_audit}}')
		) as HTMLElement;
		expect(customRow).toBeDefined();

		// Delete custom prompt via ConfirmActionModal
		clearOpenedModals();
		rowBtn(customRow, 'Delete').click();
		rowBtn(getLastOpenedModal<Modal>()!.contentEl, 'Delete').click();
		await flushUi();
		expect(plugin.settings.prompts.some((p) => p.id === 'related_work_audit')).toBe(
			false
		);
	});

	it('renders Webhooks tab: ribbon toggle, debug confirm modal, Create/Edit/Delete webhooks, IconSuggestModal, Format JSON, variables, and secret headers', async () => {
		harness.setSecret('API_TOKEN_SECRET', 'super-secret');
		settingTab.display();
		clickTab(settingTab, 'Webhooks');

		// 1. Ribbon toggle
		const ribbonToggle = findSettingByName(
			settingTab.containerEl,
			'Show webhook icon in sidebar'
		).querySelector('input[type="checkbox"]') as HTMLInputElement;
		ribbonToggle.checked = true;
		ribbonToggle.dispatchEvent(new Event('change'));
		await flushUi();
		expect(plugin.settings.webhookShowInRibbon).toBe(true);

		// 2. Debug mode toggle: Cancel keeps false, Enable anyway sets true, unchecking sets false
		const debugToggle = findSettingByName(
			settingTab.containerEl,
			'Debug mode'
		).querySelector('input[type="checkbox"]') as HTMLInputElement;
		clearOpenedModals();
		debugToggle.checked = true;
		debugToggle.dispatchEvent(new Event('change'));
		const debugModal1 = getLastOpenedModal<Modal>()!;
		Array.from(debugModal1.contentEl.querySelectorAll('button'))
			.find((b) => b.textContent === 'Cancel')!
			.click();
		await flushUi();
		expect(plugin.settings.webhookDebugMode).toBe(false);

		clearOpenedModals();
		debugToggle.checked = true;
		debugToggle.dispatchEvent(new Event('change'));
		const debugModal2 = getLastOpenedModal<Modal>()!;
		Array.from(debugModal2.contentEl.querySelectorAll('button'))
			.find((b) => b.textContent === 'Enable anyway')!
			.click();
		await flushUi();
		expect(plugin.settings.webhookDebugMode).toBe(true);

		debugToggle.checked = false;
		debugToggle.dispatchEvent(new Event('change'));
		await flushUi();
		expect(plugin.settings.webhookDebugMode).toBe(false);

		// 3. + Create Webhook -> WebhookEditModal
		clearOpenedModals();
		const createHookBtn = Array.from(
			settingTab.containerEl.querySelectorAll('button')
		).find((b) => b.textContent === '+ Create Webhook') as HTMLButtonElement;
		createHookBtn.click();
		await flushUi();

		const editModal = getLastOpenedModal<WebhookEditModal>()!;
		expect(editModal).toBeInstanceOf(WebhookEditModal);

		// Name, Show in Assistant toggle, URL, Method, ContentType
		const nameInput = findSettingByName(editModal.contentEl, 'Name').querySelector(
			'input'
		) as HTMLInputElement;
		nameInput.value = 'Deep Synth Hook';
		nameInput.dispatchEvent(new Event('input'));

		const showToggle = findSettingByName(
			editModal.contentEl,
			'Show in Assistant'
		).querySelector('input[type="checkbox"]') as HTMLInputElement;
		showToggle.checked = false;
		showToggle.dispatchEvent(new Event('change'));

		// Icon picker -> IconSuggestModal
		clearOpenedModals();
		const iconBtn = findSettingByName(editModal.contentEl, 'Icon').querySelector(
			'button'
		) as HTMLButtonElement;
		iconBtn.click();
		const iconModal = getLastOpenedModal<IconSuggestModal>()!;
		expect(iconModal).toBeInstanceOf(IconSuggestModal);
		expect(iconModal.getItems().length).toBeGreaterThan(0);
		expect(iconModal.getItemText('sparkles')).toBe('sparkles');
		const iconEl = document.createElement('div');
		iconModal.renderSuggestion(
			{ item: 'sparkles', match: { score: 1, matches: [] } },
			iconEl
		);
		expect(iconEl.textContent).toContain('sparkles');
		iconModal.onChooseItem('sparkles');
		expect(editModal.webhook.icon).toBe('sparkles');

		const urlInput = findSettingByName(editModal.contentEl, 'URL').querySelector(
			'input'
		) as HTMLInputElement;
		urlInput.value = 'https://hooks.example.com/deep';
		urlInput.dispatchEvent(new Event('input'));

		const methodSelect = findSettingByName(
			editModal.contentEl,
			'Method'
		).querySelector('select') as HTMLSelectElement;
		methodSelect.value = 'PUT';
		methodSelect.dispatchEvent(new Event('change'));

		const ctSelect = findSettingByName(
			editModal.contentEl,
			'Body Content Type'
		).querySelector('select') as HTMLSelectElement;
		ctSelect.value = 'text';
		ctSelect.dispatchEvent(new Event('change'));

		// Input variables: add two, populate one, leave one blank (filtered on save)
		const addVarBtn = editModal.contentEl.querySelector(
			'.zotero-input-var-add-btn'
		) as HTMLButtonElement;
		addVarBtn.click();
		(
			editModal.contentEl.querySelector(
				'.zotero-input-var-add-btn'
			) as HTMLButtonElement
		).click();
		const varNameInputs = Array.from(
			editModal.contentEl.querySelectorAll('.zotero-input-var-name')
		) as HTMLInputElement[];
		varNameInputs[0].value = 'focus_area';
		varNameInputs[0].dispatchEvent(new Event('input'));
		const varTypeSelects = Array.from(
			editModal.contentEl.querySelectorAll('.zotero-input-var-type')
		) as HTMLSelectElement[];
		varTypeSelects[0].value = 'text';
		varTypeSelects[0].dispatchEvent(new Event('change'));

		// Format JSON: valid JSON then invalid JSON via chip insertion
		const formatJsonBtn = Array.from(
			editModal.contentEl.querySelectorAll('.zotero-json-controls button')
		).find((b) => b.textContent === 'Format JSON') as HTMLButtonElement;
		formatJsonBtn.click();
		expect(getNoticeMessages()).toContain('JSON Formatted!');

		const firstPlaceholderChip = editModal.contentEl.querySelector(
			'.zotero-placeholder-chip'
		) as HTMLButtonElement;
		firstPlaceholderChip.click();
		formatJsonBtn.click();
		expect(getNoticeMessages()).toContain('Invalid JSON, cannot format.');

		// Custom Headers: add text header & secret header
		const clickAddHeader = () =>
			(
				Array.from(editModal.contentEl.querySelectorAll('button')).find(
					(b) => b.textContent === '+ Add Header'
				) as HTMLButtonElement
			).click();
		clickAddHeader();
		clickAddHeader();

		const headerBlocks = Array.from(
			editModal.contentEl.querySelectorAll('.zotero-setting-block')
		) as HTMLElement[];
		const h0Inputs = Array.from(
			headerBlocks[0].querySelectorAll('input')
		) as HTMLInputElement[];
		h0Inputs[0].value = 'X-Source';
		h0Inputs[0].dispatchEvent(new Event('input'));
		h0Inputs[1].value = 'Obsidian';
		h0Inputs[1].dispatchEvent(new Event('input'));

		// Switch second header to 'secret'
		const h1Inputs = Array.from(
			headerBlocks[1].querySelectorAll('input')
		) as HTMLInputElement[];
		h1Inputs[0].value = 'Authorization';
		h1Inputs[0].dispatchEvent(new Event('input'));
		const h1TypeSelect = headerBlocks[1].querySelector(
			'select'
		) as HTMLSelectElement;
		h1TypeSelect.value = 'secret';
		h1TypeSelect.dispatchEvent(new Event('change'));

		// Select secret from refreshed dropdown
		const refreshedHeaderBlocks = Array.from(
			editModal.contentEl.querySelectorAll('.zotero-setting-block')
		) as HTMLElement[];
		const secretDropdown = refreshedHeaderBlocks[1].querySelectorAll(
			'select'
		)[1] as HTMLSelectElement;
		secretDropdown.value = 'API_TOKEN_SECRET';
		secretDropdown.dispatchEvent(new Event('change'));

		// Save Webhook
		const saveHookBtn = Array.from(
			editModal.contentEl.querySelectorAll('button')
		).find((b) => b.textContent === 'Save Webhook') as HTMLButtonElement;
		saveHookBtn.click();
		await flushUi();

		expect(plugin.settings.webhooks).toHaveLength(1);
		const savedHook: WebhookProfile = plugin.settings.webhooks[0];
		expect(savedHook.name).toBe('Deep Synth Hook');
		expect(savedHook.hidden).toBe(true);
		expect(savedHook.method).toBe('PUT');
		expect(savedHook.contentType).toBe('text');
		expect(savedHook.inputVariables).toEqual([
			{ name: 'focus_area', type: 'text' },
		]);
		expect(savedHook.headers).toEqual([
			{ key: 'X-Source', value: 'Obsidian', type: 'text' },
			{ key: 'Authorization', value: 'API_TOKEN_SECRET', type: 'secret' },
		]);

		// Edit existing webhook & Delete webhook row
		const hookRow = settingTab.containerEl.querySelector(
			'.zotero-webhook-row'
		) as HTMLElement;
		expect(hookRow.textContent).toContain('Deep Synth Hook (Hidden)');
		const rowButtons = Array.from(
			hookRow.querySelectorAll('button')
		) as HTMLButtonElement[];
		clearOpenedModals();
		rowButtons[0].click();
		await flushUi();
		expect(getLastOpenedModal()).toBeInstanceOf(WebhookEditModal);

		// Delete webhook
		rowButtons[1].click();
		await flushUi();
		expect(plugin.settings.webhooks).toHaveLength(0);
	});

	it('renders CFP tab and Digest tab: basic settings, A-Z letters, URL sources, ranking diagnostics, manual CFP, and lazy Digest mount', async () => {
		const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
		requestUrl.mockResolvedValue({
			status: 200,
			headers: {},
			text: '<html><body><table></table></body></html>',
			json: {},
			arrayBuffer: new ArrayBuffer(0),
		});

		harness.addFile(
			'Conferences/OSDI/OSDI Series.md',
			[
				'---',
				'cfp-series: true',
				'series-url: "http://www.wikicfp.com/cfp/program?id=1"',
				'---',
				'',
				'```dataviewjs',
				'// old code',
				'```',
			].join('\n')
		);

		settingTab.display();
		clickTab(settingTab, 'CFP');

		// Basic settings
		const dirInput = findSettingByName(
			settingTab.containerEl,
			'CFP note folder'
		).querySelector('input') as HTMLInputElement;
		dirInput.value = 'Conferences';
		dirInput.dispatchEvent(new Event('input'));

		const tagsArea = findSettingByName(
			settingTab.containerEl,
			'Default tags'
		).querySelector('textarea') as HTMLTextAreaElement;
		tagsArea.value = 'cfp, systems\nai';
		tagsArea.dispatchEvent(new Event('input'));

		const refreshDaysInput = findSettingByName(
			settingTab.containerEl,
			'URL sources refresh (days)'
		).querySelector('input') as HTMLInputElement;
		refreshDaysInput.value = '7';
		refreshDaysInput.dispatchEvent(new Event('input'));

		const seriesDaysInput = findSettingByName(
			settingTab.containerEl,
			'Series scan interval (days)'
		).querySelector('input') as HTMLInputElement;
		seriesDaysInput.value = '14';
		seriesDaysInput.dispatchEvent(new Event('input'));

		const acronymInput = findSettingByName(
			settingTab.containerEl,
			'Conference acronym key (for CFP link)'
		).querySelector('input') as HTMLInputElement;
		acronymInput.value = 'conf_acronym';
		acronymInput.dispatchEvent(new Event('input'));
		await flushUi();

		expect(plugin.settings.cfpNoteDir).toBe('Conferences');
		expect(plugin.settings.cfpDefaultTags).toEqual(['cfp', 'systems', 'ai']);
		expect(plugin.settings.cfpRefreshDays).toBe(7);
		expect(plugin.settings.cfpSeriesRefreshDays).toBe(14);
		expect(plugin.settings.cfpAcronymKey).toBe('conf_acronym');

		// Index letters: Select All, Deselect All, single letter checkbox ('A' -> single request, zero sleep), Refresh Series
		const findBtn = (text: string) =>
			Array.from(settingTab.containerEl.querySelectorAll('button')).find(
				(b) => b.textContent === text
			) as HTMLButtonElement;

		findBtn('Select All').click();
		await flushUi();
		expect(plugin.settings.cfpSeriesIndexLetters).toHaveLength(26);

		findBtn('Deselect All').click();
		await flushUi();
		expect(plugin.settings.cfpSeriesIndexLetters).toEqual([]);

		const letterACheckbox = settingTab.containerEl.querySelector(
			'#cfp-letter-A'
		) as HTMLInputElement;
		letterACheckbox.checked = true;
		letterACheckbox.dispatchEvent(new Event('change'));
		await flushUi();
		expect(plugin.settings.cfpSeriesIndexLetters).toEqual(['A']);

		jest.useFakeTimers();
		findBtn('Refresh Series').click();
		await jest.runAllTimersAsync();
		jest.useRealTimers();
		await flushUi();
		expect(getNoticeMessages()).toContain('WikiCFP series refresh done.');

		// Update All Series Notes updates real Series note in Conferences/
		findBtn('Update All Series Notes').click();
		await flushUi();
		expect(getNoticeMessages()).toContain('Updated 1 Series notes.');

		// URL Sources: Add URL, Refresh, and Delete on WikiCFP section
		const wikiSection = settingTab.containerEl.querySelectorAll(
			'.zotero-cfp-url-section'
		)[0] as HTMLElement;
		const wikiInput = wikiSection.querySelector('input') as HTMLInputElement;
		wikiInput.value = 'http://www.wikicfp.com/cfp/call?conference=systems';
		wikiInput.dispatchEvent(new Event('input'));
		Array.from(wikiSection.querySelectorAll('button'))
			.find((b) => b.textContent === 'Add URL')!
			.click();
		await flushUi();
		expect(plugin.settings.cfpWikicfpUrls).toEqual([
			'http://www.wikicfp.com/cfp/call?conference=systems',
		]);

		requestUrl.mockClear();
		const refreshedWikiSection = settingTab.containerEl.querySelectorAll(
			'.zotero-cfp-url-section'
		)[0] as HTMLElement;
		Array.from(refreshedWikiSection.querySelectorAll('button'))
			.find((b) => b.textContent === 'Refresh')!
			.click();
		await flushUi();
		expect(requestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'http://www.wikicfp.com/cfp/call?conference=systems',
			})
		);

		// Delete added URL
		const deleteUrlBtn = refreshedWikiSection.querySelector(
			'.zotero-settings-list button'
		) as HTMLButtonElement;
		deleteUrlBtn.click();
		await flushUi();
		expect(plugin.settings.cfpWikicfpUrls).toEqual([]);

		// Ranking Sources & Check ranking sources diagnostics (unset -> missing -> found)
		clearNotices();
		findBtn('Check ranking sources').click();
		await flushUi();
		expect(getNoticeMessages()[0]).toBe(
			'CORE CSV: path not set.\nLocal allconf.yml: path not set.'
		);

		harness.addFile('CFP/CORE.csv', 'id,title,acronym,source,rank\n');
		const coreInput = findSettingByName(
			settingTab.containerEl,
			'CORE CSV path'
		).querySelector('input') as HTMLInputElement;
		coreInput.value = 'CFP/CORE.csv';
		coreInput.dispatchEvent(new Event('input'));

		const ccfInput = findSettingByName(
			settingTab.containerEl,
			'Local allconf.yml path'
		).querySelector('input') as HTMLInputElement;
		ccfInput.value = 'CFP/missing-allconf.yml';
		ccfInput.dispatchEvent(new Event('input'));
		await flushUi();

		clearNotices();
		findBtn('Check ranking sources').click();
		await flushUi();
		expect(getNoticeMessages()[0]).toBe(
			'CORE CSV: found at CFP/CORE.csv\nLocal allconf.yml: not found at CFP/missing-allconf.yml'
		);

		// Refresh All Sources & Add Manual CFP
		findBtn('Refresh All Sources').click();
		await flushUi();
		expect(plugin.settings.cfpLastFetchTime).toBeGreaterThan(0);

		clearOpenedModals();
		findBtn('Add Manual CFP').click();
		await flushUi();
		const manualModal = getLastOpenedModal<CFPManualModal>()!;
		expect(manualModal).toBeInstanceOf(CFPManualModal);
		manualModal.onSubmit({
			acronym: 'HOTOS 2027',
			fullName: 'Workshop on Hot Topics in Operating Systems',
			location: 'Banff',
			submissionDdl: '2027-01-15',
			source: 'manual',
		});
		await flushUi();
		expect(getNoticeMessages()).toContain('CFP note created.');

		// Digest tab lazy mount
		clickTab(settingTab, 'Digest');
		await flushUi();
		await flushUi();
		expect(settingTab.containerEl.textContent).toContain(
			'Translation server endpoint'
		);
		logSpy.mockRestore();
	});
});
