import { Component, TFile } from 'obsidian';
import ZoteroGKPlugin from '../../../src/main';
import {
	parseCoreNoteContent,
	resolvePaperPaths,
	serializeCoreNoteContent,
} from '../../../src/services/paper-hub';
import {
	ConnectorModal,
	renderMarkdownContent,
	VaultMarkdownSuggestModal,
} from '../../../src/ui/connector-modal';
import { requestUrl, resetObsidianMocks } from '../../__mocks__/obsidian';
import { createTestPlugin } from '../../fixtures/plugin';
import {
	clearOpenedModals,
	createTestApp,
	getLastOpenedModal,
	getNoticeMessages,
	TestAppHarness,
} from '../../fixtures/vault';

function getActionButtonLabels(modal: ConnectorModal): string[] {
	return Array.from(
		modal.contentEl.querySelectorAll('.zotero-connector-actions button')
	).map((btn) => btn.textContent?.trim() ?? '');
}

function findActionButton(modal: ConnectorModal, label: string): HTMLButtonElement {
	const found = Array.from(
		modal.contentEl.querySelectorAll('.zotero-connector-actions button')
	).find((btn) => btn.textContent?.trim() === label) as HTMLButtonElement | undefined;
	if (!found) {
		throw new Error(`Action button "${label}" not found`);
	}
	return found;
}

async function flushUi(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ConnectorModal & VaultMarkdownSuggestModal', () => {
	let harness: TestAppHarness;
	let plugin: ZoteroGKPlugin;
	let errorSpy: jest.SpyInstance;

	beforeEach(() => {
		resetObsidianMocks();
		harness = createTestApp();
		plugin = createTestPlugin(harness);
		errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		errorSpy.mockRestore();
	});

	describe('renderMarkdownContent and VaultMarkdownSuggestModal', () => {
		it('renders markdown links and opens internal links on click', async () => {
			const container = document.createElement('div');
			const comp = new Component();
			comp.load();

			await renderMarkdownContent(
				harness.app,
				'See [[003-Permanent/A - Concept|Concept Alias]] and plain text',
				container,
				'002-Literature/smith2024.md',
				comp
			);

			expect(container.classList.contains('markdown-rendered')).toBe(true);
			const linkEl = container.querySelector(
				'a.internal-link'
			) as HTMLAnchorElement | null;
			expect(linkEl).not.toBeNull();
			expect(linkEl!.textContent).toBe('Concept Alias');

			// Clicking non-link container does nothing
			container.click();
			expect(harness.openedLinks).toHaveLength(0);

			// Clicking internal link opens link text
			linkEl!.click();
			expect(harness.openedLinks).toEqual([
				{
					linktext: '003-Permanent/A - Concept',
					sourcePath: '002-Literature/smith2024.md',
				},
			]);
		});

		it('VaultMarkdownSuggestModal filters items, formats item text, and invokes onChoose', () => {
			const f1 = harness.addFile('003-Permanent/Alpha.md', '# Alpha');
			const f2 = harness.addFile('002-Literature/Beta.md', '# Beta');
			const chosen: TFile[] = [];

			const unfiltered = new VaultMarkdownSuggestModal(harness.app, (file) => {
				chosen.push(file);
			});
			expect(unfiltered.getItems()).toHaveLength(2);
			expect(unfiltered.getItemText(f1)).toBe('Alpha — 003-Permanent/Alpha.md');

			const filtered = new VaultMarkdownSuggestModal(
				harness.app,
				(file) => {
					chosen.push(file);
				},
				(file) => file.path.startsWith('003-Permanent/'),
				'Custom placeholder'
			);
			expect(filtered.getItems()).toEqual([f1]);
			expect(filtered.getItems()).not.toContain(f2);

			filtered.onChooseItem(f1);
			expect(chosen).toEqual([f1]);
		});
	});

	describe('no-citekey and empty takeaway states', () => {
		it('renders no-citekey empty message when note lacks citation key', async () => {
			const unkeyed = harness.addFile('002-Literature/unkeyed.md', '# No key');
			const modal = new ConnectorModal(harness.app, plugin, unkeyed);
			await modal.onOpen();

			expect(modal.contentEl.textContent).toContain(
				'No citation key found in this note frontmatter.'
			);
			modal.close();
			expect(modal.contentEl.children).toHaveLength(0);
		});

		it('renders empty takeaway actions: creates/opens Takeaway.md, copies synthesize prompt, and triggers visible webhooks', async () => {
			const writeText = jest.fn(async () => undefined);
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText },
				configurable: true,
			});

			plugin.settings.webhooks = [
				{
					id: 'wh-vis',
					name: 'Synthesize Takeaway',
					icon: 'send',
					url: 'https://hooks.example.com/synth',
					method: 'POST',
					contentType: 'json',
					headers: [],
					bodyTemplate: '{"key":"{{citekey}}"}',
					hidden: false,
				},
				{
					id: 'wh-hid',
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
			requestUrl.mockResolvedValue({
				status: 200,
				headers: {},
				text: 'ok',
				json: {},
				arrayBuffer: new ArrayBuffer(0),
			});

			const litFile = harness.addFile(
				'002-Literature/empty2026.md',
				'---\ncitation-key: empty2026\ntitle: Empty Paper\n---\nBody'
			);
			const onUpdated = jest.fn();
			const modal = new ConnectorModal(harness.app, plugin, litFile, onUpdated);
			await modal.onOpen();

			expect(modal.contentEl.textContent).toContain('No Takeaway Candidates Yet');
			const buttons = Array.from(
				modal.contentEl.querySelectorAll(
					'.zotero-connector-empty-actions button'
				)
			) as HTMLButtonElement[];
			expect(buttons.map((b) => b.textContent?.trim())).toEqual([
				'+ Create & Open Takeaway.md',
				'Copy Synthesize Prompt',
				'Trigger: Synthesize Takeaway',
			]);

			// Copy prompt
			buttons[1].click();
			await flushUi();
			expect(writeText).toHaveBeenCalledTimes(1);
			expect(getNoticeMessages()).toContain(
				'Copied synthesize prompt to clipboard.'
			);

			// Trigger webhook
			buttons[2].click();
			await flushUi();
			expect(requestUrl).toHaveBeenCalledTimes(1);

			// Create & Open Takeaway.md
			buttons[0].click();
			await flushUi();
			const takeawayPath = resolvePaperPaths(
				plugin.settings.paperWorkspace,
				'empty2026'
			).takeaway;
			expect(harness.getFile(takeawayPath)).not.toBeNull();
			expect(harness.openedFiles.some((f) => f.path === takeawayPath)).toBe(true);
			expect(onUpdated).toHaveBeenCalledTimes(1);
		});
	});

	describe('candidate button states, atomic picker filtering, and linking workflows', () => {
		it('enforces the 3 mutually exclusive button states: Proposed -> [Create a note, Link a note], Matched -> [Link a note, Relink a note], Linked -> [Relink a note]', async () => {
			const litFile = harness.addFile('002-Literature/tri2026.md', '', {
				'citation-key': 'tri2026',
				title: 'Three State Paper',
			});
			const paths = resolvePaperPaths(plugin.settings.paperWorkspace, 'tri2026');

			// Vault permanent notes for Candidate 2 (Matched) and Candidate 3 (Linked)
			const matchedNote = harness.addFile(
				'003-Permanent/A - Systems - Matched Concept.md',
				'# Matched Concept\n\nExisting vault body.',
				{ type: 'permanent' }
			);
			harness.addFile(
				'003-Permanent/A - Systems - Linked Concept.md',
				'# Linked Concept\n\nAlready linked body.',
				{ type: 'permanent' }
			);

			harness.addFile(
				paths.takeaway,
				[
					'## 💡 Candidate Atomic Zettels',
					'',
					'### Candidate 1 [Core Insights]',
					'- **Link**: [[A - Systems - Brand New Proposal]]',
					'- **Source**: Paper',
					'- **Link Status**: Proposed — No confirmed match',
					'- **Storyline**: Insight',
					'- **Answers**: How to avoid global locks',
					'- **Validation**: Verified on 64 cores',
					'- **Evidence**: 3.1x speedup',
					'- **Potential Tags**: #systems/locks',
					'- **Brief**: Partitioned epochs eliminate global contention.',
					'',
					'### Candidate 2 [Mechanisms]',
					'- **Link**: [[A - Systems - Matched Concept]]',
					'- **Link Status**: Existing — Matched in Vault',
					'- **Storyline**: Mechanism',
					'- **Brief**: Matches an existing unlinked permanent note.',
					'',
					'### Candidate 3 [Trade-offs]',
					'- **Link**: [[A - Systems - Linked Concept]]',
					'- **Link Status**: Existing — Linked in Vault',
					'- **Storyline**: Trade-off',
					'- **Brief**: Already linked in Core Note.',
				].join('\n')
			);

			harness.addFile(
				paths.coreNote,
				serializeCoreNoteContent({
					citekey: 'tri2026',
					source: '[[002-Literature/tri2026|tri2026]]',
					projects: [],
					linkedNotes: ['[[A - Systems - Linked Concept]]'],
					body: 'Core body.',
				})
			);

			const modal = new ConnectorModal(harness.app, plugin, litFile);
			await modal.onOpen();

			const leftItems = Array.from(
				modal.contentEl.querySelectorAll('.zotero-connector-item')
			) as HTMLElement[];
			expect(leftItems).toHaveLength(3);

			// Verify left-pane status badges
			const badges = leftItems.map(
				(el) =>
					el.querySelector('.zotero-connector-badge')?.textContent?.trim() ??
					''
			);
			expect(badges).toEqual(['Proposed', 'Matched', 'Linked']);

			// 1. Candidate 1 (Proposed) -> strictly Create a note + Link a note
			expect(getActionButtonLabels(modal)).toEqual([
				'Create a note',
				'Link a note',
			]);
			expect(
				modal.contentEl.querySelector('.zotero-connector-target-hint')
					?.textContent
			).toBe('Target: 003-Permanent/A - Systems - Brand New Proposal.md');

			// 2. Select Candidate 2 (Matched) -> strictly Link a note + Relink a note (plus preview card)
			leftItems[1].click();
			await flushUi();
			expect(getActionButtonLabels(modal)).toEqual([
				'Link a note',
				'Relink a note',
			]);
			expect(
				modal.contentEl.querySelector('.zotero-connector-preview-head')
					?.textContent
			).toContain(
				'Matched (Exact Title): 003-Permanent/A - Systems - Matched Concept.md'
			);

			// 3. Select Candidate 3 (Linked) -> strictly ONLY Relink a note
			const refreshedLeftItems = Array.from(
				modal.contentEl.querySelectorAll('.zotero-connector-item')
			) as HTMLElement[];
			refreshedLeftItems[2].click();
			await flushUi();
			expect(getActionButtonLabels(modal)).toEqual(['Relink a note']);
			expect(
				modal.contentEl.querySelector('.zotero-connector-preview-head')
					?.textContent
			).toContain(
				'Linked (Exact Title): 003-Permanent/A - Systems - Linked Concept.md'
			);

			// Clicking "Open in Obsidian" on preview opens matchedFile and closes modal
			const openLink = modal.contentEl.querySelector(
				'.zotero-connector-open-link'
			) as HTMLAnchorElement;
			openLink.click();
			await flushUi();

			// Re-open on Candidate 2 to check opening matchedNote
			const modal2 = new ConnectorModal(harness.app, plugin, litFile);
			await modal2.onOpen();
			(
				modal2.contentEl.querySelectorAll(
					'.zotero-connector-item'
				)[1] as HTMLElement
			).click();
			await flushUi();
			(
				modal2.contentEl.querySelector(
					'.zotero-connector-open-link'
				) as HTMLAnchorElement
			).click();
			await flushUi();
			expect(harness.openedFiles).toContain(matchedNote);
		});

		it('restricts the Link / Relink note picker strictly to atomicNotesFolder (003-Permanent/), excluding Literature, Takeaway, Report, Core, and Fleeting notes', async () => {
			const litFile = harness.addFile('002-Literature/filter2026.md', '', {
				'citation-key': 'filter2026',
			});
			const paths = resolvePaperPaths(
				plugin.settings.paperWorkspace,
				'filter2026'
			);

			// Populate vault across all workspace folders
			const atomRoot = harness.addFile(
				'003-Permanent/A - Permanent One.md',
				'# One'
			);
			const atomNested = harness.addFile(
				'003-Permanent/Subfolder/A - Permanent Two.md',
				'# Two'
			);
			harness.addFile('003-Permanent/diagram.png', 'binary');
			harness.addFile('002-Literature/otherPaper2025.md', '# Other Lit');
			harness.addFile(paths.report1, '# Deep Report');
			harness.addFile(paths.report2, '# External Report');
			harness.addFile(paths.coreNote, '# Core Note');
			harness.addFile('001-Fleeting/fleeting-thought.md', '# Fleeting');
			harness.addFile('Fleeting Notes/legacy-fleeting.md', '# Legacy Fleeting');
			harness.addFile('CFP/OSDI/OSDI 2026.md', '# CFP');
			harness.addFile('900-Templates/tpl.md', '# Template');
			harness.addFile(
				paths.takeaway,
				[
					'### Candidate 1 [Core Insights]',
					'- **Link**: [[A - Unmatched Proposal]]',
					'- **Link Status**: Proposed',
					'- **Brief**: Test picker filter.',
				].join('\n')
			);

			const modal = new ConnectorModal(harness.app, plugin, litFile);
			await modal.onOpen();
			clearOpenedModals();

			// Trigger "Link a note" on Proposed candidate
			findActionButton(modal, 'Link a note').click();
			const picker = getLastOpenedModal() as
				VaultMarkdownSuggestModal | undefined;
			expect(picker).toBeInstanceOf(VaultMarkdownSuggestModal);

			const listedPaths = picker!.getItems().map((f) => f.path);
			expect(listedPaths).toEqual([atomRoot.path, atomNested.path]);
		});

		it('Create a note, Link a note, and Relink a note rewrite Takeaway Link and update/prune CoreNote.linkedNotes', async () => {
			const litFile = harness.addFile('002-Literature/flow2026.md', '', {
				'citation-key': 'flow2026',
				title: 'Workflow Verification Paper',
			});
			const paths = resolvePaperPaths(plugin.settings.paperWorkspace, 'flow2026');
			const matchedAtom = harness.addFile(
				'003-Permanent/A - Systems - Initial Matched Atom.md',
				'# Initial Matched Atom',
				{ type: 'permanent' }
			);
			const replacementAtom = harness.addFile(
				'003-Permanent/Sub/A - Systems - Replacement Atom.md',
				'# Replacement Atom',
				{ type: 'permanent' }
			);

			harness.addFile(
				paths.takeaway,
				[
					'## 💡 Candidate Atomic Zettels',
					'',
					'### Candidate 1 [Core Insights]',
					'- **Link**: [[A - Systems - Created Atom]]',
					'- **Link Status**: Proposed — No confirmed match',
					'- **Storyline**: Insight',
					'- **Evidence**: 2.5x lower latency',
					'- **Brief**: Newly synthesized atomic concept.',
					'',
					'### Candidate 2 [Mechanisms]',
					'- **Link**: [[A - Systems - Initial Matched Atom]]',
					'- **Link Status**: Existing — Matched in Vault',
					'- **Storyline**: Mechanism',
					'- **Evidence**: Zero packet loss',
					'- **Brief**: Matches existing atom initially.',
				].join('\n')
			);

			const modal = new ConnectorModal(harness.app, plugin, litFile);
			await modal.onOpen();

			// 1. Candidate 1 (Proposed) -> Click "Create a note"
			findActionButton(modal, 'Create a note').click();
			await flushUi();

			const createdAtomFile = harness.getFile(
				'003-Permanent/A - Systems - Created Atom.md'
			);
			expect(createdAtomFile).not.toBeNull();
			expect(harness.getContent(createdAtomFile!.path)).toContain(
				'### Evidence from [[002-Literature/flow2026|flow2026]]'
			);
			expect(
				parseCoreNoteContent(harness.getContent(paths.coreNote)!).linkedNotes
			).toEqual(['[[A - Systems - Created Atom]]']);
			// Candidate 1 is now Linked -> ONLY "Relink a note" button
			expect(getActionButtonLabels(modal)).toEqual(['Relink a note']);

			// 2. Select Candidate 2 (Matched) -> Click "Link a note"
			(
				modal.contentEl.querySelectorAll(
					'.zotero-connector-item'
				)[1] as HTMLElement
			).click();
			await flushUi();
			expect(getActionButtonLabels(modal)).toEqual([
				'Link a note',
				'Relink a note',
			]);

			findActionButton(modal, 'Link a note').click();
			await flushUi();

			expect(harness.getContent(matchedAtom.path)).toContain(
				'### Evidence from [[002-Literature/flow2026|flow2026]]'
			);
			expect(
				parseCoreNoteContent(harness.getContent(paths.coreNote)!).linkedNotes
			).toEqual([
				'[[A - Systems - Created Atom]]',
				'[[A - Systems - Initial Matched Atom]]',
			]);
			expect(getActionButtonLabels(modal)).toEqual(['Relink a note']);

			// 3. Uncheck append-evidence checkbox and click "Relink a note" on Candidate 2 -> choose replacementAtom
			const checkbox = modal.contentEl.querySelector(
				'.zotero-connector-checkbox-row input[type="checkbox"]'
			) as HTMLInputElement;
			checkbox.checked = false;
			checkbox.dispatchEvent(new Event('change'));

			clearOpenedModals();
			findActionButton(modal, 'Relink a note').click();
			const picker = getLastOpenedModal<VaultMarkdownSuggestModal>()!;
			picker.onChooseItem(replacementAtom);
			await flushUi();

			// Takeaway Candidate 2 Link was rewritten to replacementAtom
			expect(harness.getContent(paths.takeaway)).toContain(
				'### Candidate 2 [Mechanisms]\n- **Link**: [[003-Permanent/Sub/A - Systems - Replacement Atom|A - Systems - Replacement Atom]]\n- **Link Status**: Existing — Linked in Vault'
			);
			// CoreNote.linkedNotes pruned Initial Matched Atom and added Replacement Atom
			expect(
				parseCoreNoteContent(harness.getContent(paths.coreNote)!).linkedNotes
			).toEqual([
				'[[A - Systems - Created Atom]]',
				'[[A - Systems - Replacement Atom]]',
			]);
			// Replacement atom body untouched because appendEvidence was unchecked
			expect(harness.getContent(replacementAtom.path)).toBe('# Replacement Atom');
		});
	});

	describe('Cited Vault Papers pane', () => {
		it('renders cited vault papers, links them to CoreNote.linkedNotes, and opens cited note on title click', async () => {
			const litFile = harness.addFile('002-Literature/citer2026.md', '', {
				'citation-key': 'citer2026',
			});
			const citedPaper = harness.addFile('002-Literature/raft2014.md', '', {
				'citation-key': 'raft2014',
				title: 'In Search of an Understandable Consensus Algorithm',
				year: 2014,
			});
			const paths = resolvePaperPaths(
				plugin.settings.paperWorkspace,
				'citer2026'
			);
			harness.addFile(
				paths.takeaway,
				[
					'## 📊 Research Profile',
					'- 💊 **TL;DR**:: Extends raft2014 consensus.',
				].join('\n')
			);

			const modal = new ConnectorModal(harness.app, plugin, litFile);
			await modal.onOpen();

			// 0 candidates, 1 cited paper -> renders columns with right-pane selection hint
			expect(modal.contentEl.textContent).toContain('Cited Vault Papers (1)');
			expect(modal.contentEl.textContent).toContain(
				'No ### Candidate blocks found in Takeaway.'
			);
			expect(modal.contentEl.textContent).toContain(
				'Select a Candidate Atomic Zettel on the left to review and link it.'
			);

			const linkBtn = modal.contentEl.querySelector(
				'.zotero-connector-cited-row button'
			) as HTMLButtonElement;
			expect(linkBtn.textContent?.trim()).toBe('Link');
			expect(linkBtn.disabled).toBe(false);

			linkBtn.click();
			await flushUi();

			expect(
				parseCoreNoteContent(harness.getContent(paths.coreNote)!).linkedNotes
			).toEqual(['[[raft2014]]']);
			const updatedBtn = modal.contentEl.querySelector(
				'.zotero-connector-cited-row button'
			) as HTMLButtonElement;
			expect(updatedBtn.textContent?.trim()).toBe('Linked');
			expect(updatedBtn.disabled).toBe(true);

			// Clicking cited title opens citedPaper
			const citedTitle = modal.contentEl.querySelector(
				'.zotero-connector-cited-title'
			) as HTMLAnchorElement;
			citedTitle.click();
			await flushUi();
			expect(harness.openedFiles).toContain(citedPaper);
		});

		it('renders Concept Overlap preview and surfaces error Notices when vault or clipboard actions fail', async () => {
			// 1. Empty state failure paths (Takeaway create error & clipboard error)
			Object.defineProperty(navigator, 'clipboard', {
				value: {
					writeText: jest.fn(async () => {
						throw new Error('Clipboard denied');
					}),
				},
				configurable: true,
			});

			const emptyLit = harness.addFile('002-Literature/err2026.md', '', {
				'citation-key': 'err2026',
			});
			const emptyModal = new ConnectorModal(harness.app, plugin, emptyLit);
			await emptyModal.onOpen();

			const emptyBtns = Array.from(
				emptyModal.contentEl.querySelectorAll(
					'.zotero-connector-empty-actions button'
				)
			) as HTMLButtonElement[];

			harness.mockApp.vault.create.mockRejectedValueOnce(
				new Error('Disk read-only')
			);
			emptyBtns[0].click();
			await flushUi();
			expect(
				getNoticeMessages().some((m) =>
					m.includes('Failed to open Takeaway.md: Disk read-only')
				)
			).toBe(true);

			emptyBtns[1].click();
			await flushUi();
			expect(
				getNoticeMessages().some((m) =>
					m.includes('Failed to copy prompt: Clipboard denied')
				)
			).toBe(true);

			// 2. Overlap preview + Create / Link / Cited Link error Notice paths
			const overlapNote = harness.addFile(
				'003-Permanent/A - Storage - Consensus - Quorum Lease Read.md',
				'# Quorum Lease Read',
				{ type: 'permanent' }
			);
			expect(overlapNote).toBeDefined();
			harness.addFile('002-Literature/peerCite2020.md', '', {
				'citation-key': 'peerCite2020',
				title: 'Peer Cited Paper',
				year: 2020,
			});
			const paths = resolvePaperPaths(plugin.settings.paperWorkspace, 'err2026');
			harness.addFile(
				paths.takeaway,
				[
					'### Candidate 1 [Mechanisms]',
					'- **Link**: [[A - Distributed - Consensus - Quorum Lease Protocol]]',
					'- **Storyline**: Storyline fallback subtext',
					'- **Related Papers**: peerCite2020',
					'',
					'### Candidate 2 [Insights]',
					'- **Link**: [[A - Compilers - Brand New Concept]]',
					'- **Storyline**: Insight',
				].join('\n')
			);

			const modal2 = new ConnectorModal(harness.app, plugin, emptyLit);
			await modal2.onOpen();

			expect(
				modal2.contentEl.querySelector('.zotero-connector-preview-head')
					?.textContent
			).toContain('Matched (Concept Overlap):');

			// Link error on Matched candidate
			harness.mockApp.vault.create.mockRejectedValueOnce(
				new Error('Core write failed')
			);
			findActionButton(modal2, 'Link a note').click();
			await flushUi();
			expect(
				getNoticeMessages().some((m) =>
					m.includes('Failed to link note: Core write failed')
				)
			).toBe(true);

			// Cited paper Link error
			harness.mockApp.vault.create.mockRejectedValueOnce(
				new Error('Cited core write failed')
			);
			(
				modal2.contentEl.querySelector(
					'.zotero-connector-cited-row button'
				) as HTMLButtonElement
			).click();
			await flushUi();
			expect(
				getNoticeMessages().some((m) =>
					m.includes('Failed to link paper: Cited core write failed')
				)
			).toBe(true);

			// Select Candidate 2 (Proposed) -> Create error
			(
				modal2.contentEl.querySelectorAll(
					'.zotero-connector-item'
				)[1] as HTMLElement
			).click();
			await flushUi();
			harness.mockApp.vault.create.mockRejectedValueOnce(
				new Error('Atomic create failed')
			);
			findActionButton(modal2, 'Create a note').click();
			await flushUi();
			expect(
				getNoticeMessages().some((m) =>
					m.includes('Failed to create note: Atomic create failed')
				)
			).toBe(true);
		});
	});
});
