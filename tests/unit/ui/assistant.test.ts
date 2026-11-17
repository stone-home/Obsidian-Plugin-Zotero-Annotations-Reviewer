import { Modal, SuggestModal, TFile } from 'obsidian';
import ZoteroGKPlugin from '../../../src/main';
import {
	parseCoreNoteContent,
	resolvePaperPaths,
	serializeCoreNoteContent,
} from '../../../src/services/paper-hub';
import { AssistantView, isDoiUrl } from '../../../src/ui/assistant';
import {
	ConnectorModal,
	VaultMarkdownSuggestModal,
} from '../../../src/ui/connector-modal';
import { VIEW_TYPE_DIGEST, PaperDigestView } from '../../../src/ui/digest-view';
import { HighlightModal } from '../../../src/ui/highlights';
import { request, requestUrl, resetObsidianMocks } from '../../__mocks__/obsidian';
import { createTestPlugin } from '../../fixtures/plugin';
import {
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

describe('isDoiUrl', () => {
	it('accepts doi.org and *.doi.org hostnames and rejects spoofing or invalid URLs', () => {
		expect(isDoiUrl('https://doi.org/10.1145/1327452.1327492')).toBe(true);
		expect(isDoiUrl('http://DOI.ORG/10.1000/182')).toBe(true);
		expect(isDoiUrl('https://dx.doi.org/10.1038/nature12373')).toBe(true);
		expect(isDoiUrl('https://hdl.doi.org/10.1000/xyz')).toBe(true);

		expect(isDoiUrl('https://example.com/doi.org/10.1000/1')).toBe(false);
		expect(isDoiUrl('https://evil-doi.org/10.1000/1')).toBe(false);
		expect(isDoiUrl('https://doi.org.evil.com/10.1000/1')).toBe(false);
		expect(isDoiUrl('https://arxiv.org/abs/2401.00001?doi=doi.org')).toBe(false);

		expect(isDoiUrl('')).toBe(false);
		expect(isDoiUrl('   ')).toBe(false);
		expect(isDoiUrl('10.1145/1327452.1327492')).toBe(false);
		expect(isDoiUrl('doi.org/10.1000/1')).toBe(false);
		expect(isDoiUrl('doi:10.1000/1')).toBe(false);
		expect(isDoiUrl('not a url')).toBe(false);
	});
});

describe('AssistantView', () => {
	let harness: TestAppHarness;
	let plugin: ZoteroGKPlugin;
	let warnSpy: jest.SpyInstance;
	let errorSpy: jest.SpyInstance;

	beforeEach(() => {
		resetObsidianMocks();
		harness = createTestApp();
		plugin = createTestPlugin(harness, {
			projectsFolder: '004-Projects',
			projectIdKey: 'project_code',
		});
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

	it('guards non-note sourcePath and handles missing citation key with optional legacy DataviewJS script', async () => {
		const container = document.createElement('div');
		const view = new AssistantView(container, plugin);

		// Non-existent sourcePath
		await view.render('', harness.createPostProcessorContext('Missing/Note.md'));
		expect(container.textContent).toBe('Assistant only works in notes.');

		// Note without citation-key, legacy script enabled, Dataview unavailable
		const unkeyed = harness.addFile('002-Literature/unkeyed.md', '# Unkeyed');
		plugin.settings.enableLegacyAssistantScript = true;
		plugin.settings.assistantScript = 'dv.paragraph("legacy");';

		await view.render(
			'{\n"ANN1": "Assets/fig1.png"\n}',
			harness.createPostProcessorContext(unkeyed.path)
		);
		expect(container.textContent).toContain(
			'No citation key found (citation-key).'
		);
		expect(container.textContent).toContain('Dataview plugin not found.');

		// Register Dataview plugin and verify script execution with parsed params
		const executeJs = jest.fn(async () => undefined);
		harness.registerPlugin('dataview', {
			settings: { enableDataviewJs: true },
			api: { executeJs },
		});

		await view.render(
			'{\n"ANN1": "Assets/fig1.png"\n}',
			harness.createPostProcessorContext(unkeyed.path)
		);
		expect(executeJs).toHaveBeenCalledWith(
			expect.stringContaining('const input ='),
			expect.any(HTMLElement),
			view,
			unkeyed.path
		);
	});

	it('renders topbar actions (Refresh, Highlights, Connector badge) and triggers toolbar webhooks (direct and with input modal)', async () => {
		const runImport = jest.fn(async () => undefined);
		harness.registerPlugin('obsidian-zotero-desktop-connector', {
			settings: { exportFormats: [{ name: 'Literature' }] },
			runImport,
		});
		request.mockResolvedValue(JSON.stringify({ result: [] }));
		requestUrl.mockResolvedValue({
			status: 200,
			headers: {},
			text: 'ok',
			json: {},
			arrayBuffer: new ArrayBuffer(0),
		});

		plugin.settings.webhooks = [
			{
				id: 'wh-direct',
				name: 'Quick Sync',
				icon: 'zap',
				url: 'https://hooks.example.com/quick',
				method: 'POST',
				contentType: 'json',
				headers: [],
				bodyTemplate: '{"citekey":"{{citekey}}"}',
				hidden: false,
			},
			{
				id: 'wh-vars',
				name: 'Parameterized Run',
				icon: 'send',
				url: 'https://hooks.example.com/vars',
				method: 'POST',
				contentType: 'json',
				headers: [],
				bodyTemplate: '{"topic":"{{topic}}","depth":{{depth}}}',
				hidden: false,
				inputVariables: [
					{ name: 'topic', type: 'text' },
					{ name: 'depth', type: 'number' },
				],
			},
			{
				id: 'wh-hidden',
				name: 'Hidden Hook',
				icon: 'send',
				url: 'https://hooks.example.com/hidden',
				method: 'POST',
				contentType: 'json',
				headers: [],
				bodyTemplate: '{}',
				hidden: true,
			},
		];

		const litFile = harness.addFile('002-Literature/smith2025.md', '', {
			'citation-key': 'smith2025',
			title: 'Distributed Leases',
		});
		const paths = resolvePaperPaths(plugin.settings.paperWorkspace, 'smith2025');
		harness.addFile(
			paths.takeaway,
			'### Candidate 1 [Insights]\n- **Link**: [[A - Lease]]\n- **Brief**: Fast.'
		);

		const container = document.createElement('div');
		const view = new AssistantView(container, plugin);
		await view.render('', harness.createPostProcessorContext(litFile.path));

		const iconBtns = Array.from(
			container.querySelectorAll(
				'.zotero-assistant-toolbar .extra-setting-button'
			)
		) as HTMLElement[];
		expect(iconBtns).toHaveLength(3);
		expect(iconBtns[2].classList.contains('has-badge')).toBe(true);

		// 1. Refresh metadata from Zotero
		iconBtns[0].click();
		await flushUi();
		expect(runImport).toHaveBeenCalledWith('Literature', 'smith2025');

		// 2. Open HighlightModal
		clearOpenedModals();
		iconBtns[1].click();
		expect(getLastOpenedModal()).toBeInstanceOf(HighlightModal);

		// 3. Open ConnectorModal
		clearOpenedModals();
		iconBtns[2].click();
		expect(getLastOpenedModal()).toBeInstanceOf(ConnectorModal);

		// 4. Visible vs Hidden Webhooks
		const hookPills = Array.from(
			container.querySelectorAll('.zotero-webhook-pill')
		) as HTMLButtonElement[];
		expect(hookPills.map((b) => b.textContent?.trim())).toEqual([
			'Quick Sync',
			'Parameterized Run',
		]);

		// Direct webhook trigger
		hookPills[0].click();
		await flushUi();
		expect(requestUrl).toHaveBeenCalledTimes(1);

		// Parameterized webhook opens AssistantWebhookInputModal (test Cancel then Trigger)
		clearOpenedModals();
		hookPills[1].click();
		const varModal1 = getLastOpenedModal<Modal>()!;
		Array.from(varModal1.contentEl.querySelectorAll('button'))
			.find((b) => b.textContent === 'Cancel')!
			.click();
		expect(requestUrl).toHaveBeenCalledTimes(1);

		clearOpenedModals();
		hookPills[1].click();
		const varModal2 = getLastOpenedModal<Modal>()!;
		const inputs = Array.from(
			varModal2.contentEl.querySelectorAll('input')
		) as HTMLInputElement[];
		inputs[0].value = 'consensus';
		inputs[0].dispatchEvent(new Event('input'));
		inputs[1].value = '03';
		inputs[1].dispatchEvent(new Event('input'));
		Array.from(varModal2.contentEl.querySelectorAll('button'))
			.find((b) => b.textContent === 'Trigger')!
			.click();
		await flushUi();

		expect(requestUrl).toHaveBeenCalledTimes(2);
		const secondCallArg = requestUrl.mock.calls[1][0];
		const secondBody =
			typeof secondCallArg === 'string' ? '' : String(secondCallArg.body ?? '');
		expect(secondBody).toContain('"topic":"consensus"');
		expect(secondBody).toContain('"depth":3');
	});

	it('renders Report 1/2/Takeaway pills, DOI/URL pill, and Code repository pill (including CodeUrlModal validation, auto-https, Clear, and Save)', async () => {
		const litFile = harness.addFile('002-Literature/vaswani2017.md', '', {
			'citation-key': 'vaswani2017',
			title: 'Attention Is All You Need',
			doi: '10.48550/arXiv.1706.03762',
			'deep-report': 'https://gemini.google.com/share/attn',
		});

		const container = document.createElement('div');
		const view = new AssistantView(container, plugin);
		await view.render('', harness.createPostProcessorContext(litFile.path));

		// DOI pill shows "DOI"
		const doiPill = container.querySelector(
			'a.zotero-res-pill.is-external[href*="doi.org"]'
		) as HTMLAnchorElement;
		expect(doiPill).not.toBeNull();
		expect(doiPill.textContent).toBe('DOI');

		// Legacy external report compact pill rendered
		expect(container.querySelector('a.is-compact-url')?.getAttribute('href')).toBe(
			'https://gemini.google.com/share/attn'
		);

		// Copy prompt button on missing Deep Report
		const copyBtns = Array.from(
			container.querySelectorAll('.zotero-res-pill-copy')
		) as HTMLButtonElement[];
		expect(copyBtns).toHaveLength(3);
		copyBtns[1].click();
		await flushUi();
		expect(getNoticeMessages()).toContain(
			'Copied Deep Report prompt to clipboard.'
		);

		// Create missing Deep Report -> creates file from template, opens it, and rerenders as present pill
		const createDeepBtn = Array.from(
			container.querySelectorAll('button.zotero-res-pill.is-missing')
		).find((b) => b.textContent?.includes('+ Deep Report')) as HTMLButtonElement;
		createDeepBtn.click();
		await flushUi();

		const paths = resolvePaperPaths(plugin.settings.paperWorkspace, 'vaswani2017');
		const createdR1 = harness.getFile(paths.report1);
		expect(createdR1).not.toBeNull();
		expect(harness.openedFiles).toContain(createdR1);

		// Present Deep Report pill opens existing file
		harness.openedFiles.length = 0;
		const presentDeepBtn = Array.from(
			container.querySelectorAll('button.zotero-res-pill.is-present')
		).find((b) => b.textContent === 'Deep Report') as HTMLButtonElement;
		expect(presentDeepBtn).toBeDefined();
		presentDeepBtn.click();
		await flushUi();
		expect(harness.openedFiles).toContain(createdR1);

		// Code repository pill: "+ Code" -> CodeUrlModal
		clearOpenedModals();
		const addCodeBtn = container.querySelector(
			'.is-code-missing'
		) as HTMLButtonElement;
		expect(addCodeBtn.textContent).toBe('+ Code');
		addCodeBtn.click();

		const codeModal = getLastOpenedModal<Modal>()!;
		const codeInput = codeModal.contentEl.querySelector(
			'input'
		) as HTMLInputElement;
		const saveBtn = Array.from(codeModal.contentEl.querySelectorAll('button')).find(
			(b) => b.textContent === 'Save'
		) as HTMLButtonElement;

		// Invalid scheme rejected with Notice
		codeInput.value = 'ftp://invalid.host/repo';
		saveBtn.click();
		await flushUi();
		expect(getNoticeMessages()).toContain(
			'Please enter a valid http(s) repository URL.'
		);

		// Bare domain auto-prefixed with https:// on Enter key
		codeInput.value = 'github.com/tensorflow/tensor2tensor';
		codeInput.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
		);
		await flushUi();

		expect(harness.getFrontmatter(litFile.path)?.code).toBe(
			'https://github.com/tensorflow/tensor2tensor'
		);
		expect(
			container.querySelector('a.zotero-res-pill.is-code')?.getAttribute('href')
		).toBe('https://github.com/tensorflow/tensor2tensor');

		// Edit existing Code URL -> Clear removes URL
		clearOpenedModals();
		const editCodeBtn = container.querySelector(
			'.zotero-res-pill-edit'
		) as HTMLElement;
		editCodeBtn.click();
		const editModal = getLastOpenedModal<Modal>()!;
		Array.from(editModal.contentEl.querySelectorAll('button'))
			.find((b) => b.textContent === 'Clear')!
			.click();
		await flushUi();
		expect(harness.getFrontmatter(litFile.path)?.code).toBe('');
		expect(container.querySelector('.is-code-missing')).not.toBeNull();

		// Generic non-DOI URL renders "URL" pill
		const urlPaper = harness.addFile('002-Literature/arxiv2026.md', '', {
			'citation-key': 'arxiv2026',
			url: 'https://arxiv.org/abs/2601.00001',
		});
		await view.render('', harness.createPostProcessorContext(urlPaper.path));
		expect(
			container.querySelector('a.zotero-res-pill.is-external')?.textContent
		).toBe('URL');
	});

	it('supports Core Note TL;DR pull, Open Core Note, click-to-edit save/cancel, Projects & Linked Notes chips, and Fleeting read toggles', async () => {
		const litFile = harness.addFile('002-Literature/coreflow2026.md', '', {
			'citation-key': 'coreflow2026',
			title: 'Core Flow Paper',
		});
		const paths = resolvePaperPaths(plugin.settings.paperWorkspace, 'coreflow2026');
		harness.addFile(
			paths.takeaway,
			'## 📊 Research Profile\n- 💊 **TL;DR**:: Concise takeaway summary.'
		);
		const dashProj = harness.addFile(
			'004-Projects/SysProj/Dashboard.md',
			'---\nproject_name: Systems Project\nproject_code: SYS\n---\n'
		);
		const atomNote = harness.addFile(
			'003-Permanent/A - Systems - Epoch Reclamation.md',
			'# Epoch Reclamation'
		);
		harness.addFile('002-Literature/excludedFromAtomPicker.md', '# Lit');
		const fleeting = harness.addFile(
			'001-Fleeting/hl-epoch.md',
			'---\ncitation-key: coreflow2026\nread: false\n---\n## Thoughts\nCheck memory bound.',
			{ 'citation-key': 'coreflow2026', read: false }
		);

		const container = document.createElement('div');
		const view = new AssistantView(container, plugin);
		await view.render('', harness.createPostProcessorContext(litFile.path));

		// 1. Core Note placeholder -> click to edit -> Escape cancels without creating Core Note
		const displayEl = container.querySelector(
			'.zotero-core-note-display'
		) as HTMLElement;
		expect(displayEl.textContent).toContain(
			'Click to write core claim & personal takeaways...'
		);
		displayEl.click();
		const escTextarea = container.querySelector(
			'textarea.zotero-core-note-editor'
		) as HTMLTextAreaElement;
		escTextarea.value = 'Discarded draft';
		escTextarea.dispatchEvent(new Event('input'));
		escTextarea.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
		);
		await flushUi();
		expect(harness.getFile(paths.coreNote)).toBeNull();

		// 2. Click to edit -> Ctrl+Enter saves Core Note with internal link
		(container.querySelector('.zotero-core-note-display') as HTMLElement).click();
		const saveTextarea = container.querySelector(
			'textarea.zotero-core-note-editor'
		) as HTMLTextAreaElement;
		saveTextarea.value = 'Core claim referencing [[003-Permanent/Ref|Ref]].';
		saveTextarea.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'Enter',
				ctrlKey: true,
				cancelable: true,
			})
		);
		await flushUi();
		expect(parseCoreNoteContent(harness.getContent(paths.coreNote)!).body).toBe(
			'Core claim referencing [[003-Permanent/Ref|Ref]].'
		);

		// Clicking internal link inside Core Note opens link rather than entering edit mode
		const inlineCoreLink = container.querySelector(
			'.zotero-core-note-display a.internal-link'
		) as HTMLAnchorElement;
		inlineCoreLink.click();
		expect(harness.openedLinks).toContainEqual({
			linktext: '003-Permanent/Ref',
			sourcePath: litFile.path,
		});
		expect(container.querySelector('textarea.zotero-core-note-editor')).toBeNull();

		// 3. Pull TL;DR from Takeaway appends blockquote to existing Core Note body
		const coreActions = Array.from(
			container.querySelectorAll(
				'.zotero-core-note-actions .extra-setting-button'
			)
		) as HTMLElement[];
		expect(coreActions).toHaveLength(2);
		coreActions[0].click();
		await flushUi();
		expect(
			parseCoreNoteContent(harness.getContent(paths.coreNote)!).body
		).toContain('> **TL;DR**: Concise takeaway summary.');

		// Open Core Note button opens coreNote in workspace
		coreActions[1].click();
		await flushUi();
		expect(harness.openedFiles.some((f) => f.path === paths.coreNote)).toBe(true);

		// 4. Add Project via AssistantProjectSuggestModal, click chip, then remove chip
		const addButtons = Array.from(
			container.querySelectorAll('.zotero-links-bar .extra-setting-button')
		) as HTMLElement[];
		clearOpenedModals();
		addButtons[0].click();
		const projModal = getLastOpenedModal<SuggestModal<TFile>>()!;
		expect(projModal.getSuggestions('')).toEqual([dashProj]);
		const sugDiv = document.createElement('div');
		projModal.renderSuggestion(dashProj, sugDiv);
		expect(sugDiv.textContent).toContain('Systems Project');
		projModal.onChooseSuggestion(dashProj, new MouseEvent('click'));
		await flushUi();

		const projChipLink = container.querySelector(
			'.zotero-link-chip.is-project a'
		) as HTMLAnchorElement;
		expect(projChipLink.textContent).toBe('SYS');
		projChipLink.click();
		expect(harness.openedLinks).toContainEqual({
			linktext: '004-Projects/SysProj/Dashboard',
			sourcePath: litFile.path,
		});

		(
			container.querySelector(
				'.zotero-link-chip.is-project .zotero-link-chip-remove'
			) as HTMLElement
		).click();
		await flushUi();
		expect(container.querySelector('.zotero-link-chip.is-project')).toBeNull();

		// 5. Add Linked Atomic Note via VaultMarkdownSuggestModal (strictly 003-Permanent/), click chip, then unlink
		clearOpenedModals();
		const refreshedAddButtons = Array.from(
			container.querySelectorAll('.zotero-links-bar .extra-setting-button')
		) as HTMLElement[];
		refreshedAddButtons[1].click();
		const atomPicker = getLastOpenedModal<VaultMarkdownSuggestModal>()!;
		expect(atomPicker.getItems()).toEqual([atomNote]);
		atomPicker.onChooseItem(atomNote);
		await flushUi();

		const linkedChipLink = container.querySelector(
			'.zotero-link-chip:not(.is-project) a'
		) as HTMLAnchorElement;
		expect(linkedChipLink.textContent).toBe('A - Systems - Epoch Reclamation');
		linkedChipLink.click();
		expect(harness.openedLinks).toContainEqual({
			linktext: 'A - Systems - Epoch Reclamation',
			sourcePath: litFile.path,
		});
		(
			container.querySelector(
				'.zotero-link-chip:not(.is-project) .zotero-link-chip-remove'
			) as HTMLElement
		).click();
		await flushUi();
		expect(
			parseCoreNoteContent(harness.getContent(paths.coreNote)!).linkedNotes
		).toEqual([]);

		// 6. Inline Highlight / Fleeting notes: open note + toggle Unread -> Read
		expect(
			container.querySelector('.zotero-inline-comments-header')?.textContent
		).toBe('Highlights & Thoughts (1)');
		const fleetingLink = container.querySelector(
			'.zotero-inline-comment-link'
		) as HTMLAnchorElement;
		fleetingLink.click();
		expect(harness.openedFiles).toContain(fleeting);

		const readBadge = container.querySelector(
			'.zotero-read-badge'
		) as HTMLButtonElement;
		expect(readBadge.textContent).toBe('Unread');
		readBadge.click();
		await flushUi();
		expect(harness.getFrontmatter(fleeting.path)?.read).toBe(true);
		expect(container.querySelector('.zotero-read-badge')?.textContent).toBe('Read');
	});

	it('renders CFP venue bar (CORE/CCF ranks & Series link) and caps Same-Venue Papers at 3 chips with +N in Library jump', async () => {
		// Register Digest view so openPaperLibrary opens PaperDigestView cleanly
		plugin.registerView(
			VIEW_TYPE_DIGEST,
			(leaf) => new PaperDigestView(leaf, plugin)
		);

		// Create CFP Series note with CORE & CCF ranks
		const seriesNote = harness.addFile(
			'CFP/OSDI/OSDI Series.md',
			[
				'---',
				'cfp-series: true',
				'acronym: OSDI',
				'rank_core: "A*"',
				'rank_ccf: "A"',
				'---',
				'# OSDI Series',
			].join('\n')
		);

		const currentLit = harness.addFile('002-Literature/curr2026.md', '', {
			'citation-key': 'curr2026',
			title: 'Current OSDI Paper',
			'conference-acronym': '[[CFP/OSDI/OSDI Series|OSDI]]',
			venue: 'OSDI',
			year: 2026,
		});

		// Create 5 peer papers in the same venue -> 3 chips + "+2 in Library →"
		const peerFiles: TFile[] = [];
		for (let i = 1; i <= 5; i++) {
			peerFiles.push(
				harness.addFile(`002-Literature/peer${i}.md`, '', {
					'citation-key': `peer${i}`,
					'short-name': `Peer${i}`,
					title: `Peer Paper ${i}`,
					venue: '[[OSDI Series]]',
					year: 2026 - i,
				})
			);
		}

		const container = document.createElement('div');
		const view = new AssistantView(container, plugin);
		await view.render('', harness.createPostProcessorContext(currentLit.path));

		expect(container.querySelector('.zotero-venue-acronym')?.textContent).toBe(
			'OSDI'
		);
		expect(container.querySelector('.zotero-venue-rank.is-core')?.textContent).toBe(
			'CORE A*'
		);
		expect(container.querySelector('.zotero-venue-rank.is-ccf')?.textContent).toBe(
			'CCF A'
		);

		// Series link opens OSDI Series.md
		const seriesLink = container.querySelector(
			'.zotero-venue-series-link'
		) as HTMLAnchorElement;
		expect(seriesLink.textContent).toBe('OSDI Series');
		seriesLink.click();
		expect(harness.openedFiles).toContain(seriesNote);

		// 3-chip cap + "+2 in Library →"
		const peerChips = Array.from(
			container.querySelectorAll('.zotero-venue-peer-chip')
		) as HTMLAnchorElement[];
		expect(peerChips).toHaveLength(3);
		expect(peerChips.map((c) => c.textContent)).toEqual([
			'Peer1 2025',
			'Peer2 2024',
			'Peer3 2023',
		]);

		peerChips[0].click();
		expect(harness.openedFiles).toContain(peerFiles[0]);

		const jumpBtn = container.querySelector(
			'.zotero-venue-library-btn'
		) as HTMLButtonElement;
		expect(jumpBtn.textContent).toBe('+2 in Library →');
		jumpBtn.click();
		await flushUi();
		await flushUi();
		expect(
			harness.mockApp.workspace.getLeavesOfType(VIEW_TYPE_DIGEST)
		).toHaveLength(1);

		// Also verify <=3 peers renders "Library (N) →"
		const nsdiCurrent = harness.addFile(
			'002-Literature/nsdiCurr.md',
			serializeCoreNoteContent({
				citekey: 'nsdiCurr',
				source: '',
				projects: [],
				linkedNotes: [],
				body: '',
			}),
			{ 'citation-key': 'nsdiCurr', venue: '[[NSDI]]', year: 2026 }
		);
		harness.addFile('002-Literature/nsdiPeer1.md', '', {
			'citation-key': 'nsdiPeer1',
			'short-name': 'NetA',
			venue: '[[NSDI]]',
			year: 2025,
		});
		await view.render('', harness.createPostProcessorContext(nsdiCurrent.path));
		expect(container.querySelector('.zotero-venue-library-btn')?.textContent).toBe(
			'Library (1) →'
		);
	});
});
