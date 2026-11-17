import ZoteroGKPlugin from '../../../src/main';
import { CFPItem } from '../../../src/types';
import { CFPListModal } from '../../../src/ui/cfp-list-modal';
import { CFPListView } from '../../../src/ui/cfp-list-view';
import { CFPManualModal } from '../../../src/ui/cfp-manual-modal';
import { resetObsidianMocks } from '../../__mocks__/obsidian';
import { createTestPlugin } from '../../fixtures/plugin';
import { createTestApp, getNoticeMessages, TestAppHarness } from '../../fixtures/vault';

describe('CFP UI components (CFPListModal, CFPListView, CFPManualModal)', () => {
	let harness: TestAppHarness;
	let plugin: ZoteroGKPlugin;

	beforeEach(() => {
		resetObsidianMocks();
		harness = createTestApp();
		plugin = createTestPlugin(harness);
	});

	describe('CFPListModal', () => {
		it('renders empty sections when upcoming and past lists are empty', () => {
			const modal = new CFPListModal(harness.app, { upcoming: [], past: [] });
			modal.open();

			const empties = Array.from(
				modal.contentEl.querySelectorAll('.zotero-cfp-list-empty')
			).map((e) => e.textContent);
			expect(empties).toEqual(['None', 'None']);
		});

		it('renders upcoming and past rows, truncates >50-char names, and opens TFile on row click', () => {
			const cfpFile = harness.addFile('CFP/OSDI/OSDI 2027.md', '# OSDI 2027');
			const longName =
				'USENIX Symposium on Operating Systems Design and Implementation Extended Edition';
			const item: CFPItem = {
				acronym: 'OSDI 2027',
				fullName: longName,
				location: 'Boston, USA',
				submissionDdl: '2026-12-10',
				source: 'wikicfp',
			};

			const modal = new CFPListModal(harness.app, {
				upcoming: [{ item, path: cfpFile.path }],
				past: [
					{
						item: { ...item, acronym: 'SOSP 2024', fullName: 'Short Name' },
						path: 'CFP/Missing.md',
					},
				],
			});
			modal.open();

			const rows = Array.from(
				modal.contentEl.querySelectorAll('.zotero-cfp-list-row')
			) as HTMLElement[];
			expect(rows).toHaveLength(2);
			expect(rows[0].querySelector('.zotero-cfp-name')?.textContent).toBe(
				`${longName.slice(0, 50)}…`
			);
			expect(rows[1].querySelector('.zotero-cfp-name')?.textContent).toBe(
				'Short Name'
			);

			// Clicking row with existing file opens file
			rows[0].click();
			expect(harness.openedFiles).toContain(cfpFile);

			// Clicking row with missing file still closes cleanly without throwing
			rows[1].click();
			expect(harness.openedFiles).toHaveLength(1);
		});
	});

	describe('CFPListView', () => {
		it('renders empty state and populated CFP notes from vault and opens note on click', async () => {
			const emptyContainer = document.createElement('div');
			const emptyView = new CFPListView(emptyContainer, plugin);
			await emptyView.render();
			expect(
				emptyContainer.querySelectorAll('.zotero-cfp-list-empty')
			).toHaveLength(2);

			const upcomingNote = harness.addFile(
				'CFP/NSDI/NSDI 2028.md',
				[
					'---',
					'acronym: "NSDI 2028"',
					'full-name: "USENIX Symposium on Networked Systems Design and Implementation"',
					'location: "Seattle, USA"',
					'submission-ddl: "2027-09-15"',
					'---',
					'# NSDI 2028',
				].join('\n')
			);

			const container = document.createElement('div');
			const view = new CFPListView(container, plugin);
			await view.render();

			const row = container.querySelector('.zotero-cfp-list-row') as HTMLElement;
			expect(row).not.toBeNull();
			expect(row.querySelector('.zotero-cfp-acronym')?.textContent).toBe(
				'NSDI 2028'
			);
			expect(row.querySelector('.zotero-cfp-name')?.textContent).toContain('…');

			row.click();
			expect(harness.openedFiles).toContain(upcomingNote);
		});
	});

	describe('CFPManualModal', () => {
		it('validates that acronym or full name is required, derives fallbacks, and handles Cancel vs Save', () => {
			const submitted: CFPItem[] = [];
			const modal = new CFPManualModal(harness.app, ['cfp'], (item) =>
				submitted.push(item)
			);
			modal.open();

			const buttons = Array.from(
				modal.contentEl.querySelectorAll('button')
			) as HTMLButtonElement[];
			const cancelBtn = buttons.find((b) => b.textContent === 'Cancel')!;
			const saveBtn = buttons.find((b) => b.textContent === 'Save')!;

			// Blank save -> validation Notice
			saveBtn.click();
			expect(getNoticeMessages()).toContain('Acronym or full name required.');
			expect(submitted).toHaveLength(0);

			// Cancel closes without submitting
			cancelBtn.click();
			expect(submitted).toHaveLength(0);

			// Full name only -> derives hyphenated acronym and defaults location/ddl to N/A
			const modal2 = new CFPManualModal(harness.app, ['cfp'], (item) =>
				submitted.push(item)
			);
			modal2.open();
			const inputs2 = Array.from(
				modal2.contentEl.querySelectorAll('input')
			) as HTMLInputElement[];
			inputs2[1].value = 'Workshop on Kernel Bypass Systems';
			inputs2[1].dispatchEvent(new Event('input'));
			Array.from(modal2.contentEl.querySelectorAll('button'))
				.find((b) => b.textContent === 'Save')!
				.click();

			expect(submitted[0]).toEqual({
				acronym: 'Workshop-on-Kernel-Bypass-Syst',
				fullName: 'Workshop on Kernel Bypass Systems',
				location: 'N/A',
				start: undefined,
				end: undefined,
				submissionDdl: 'N/A',
				source: 'manual',
			});

			// Acronym + all fields populated
			const modal3 = new CFPManualModal(harness.app, ['cfp'], (item) =>
				submitted.push(item)
			);
			modal3.open();
			const inputs3 = Array.from(
				modal3.contentEl.querySelectorAll('input')
			) as HTMLInputElement[];
			inputs3[0].value = 'CHIL 2027';
			inputs3[0].dispatchEvent(new Event('input'));
			inputs3[2].value = 'Boston, MA';
			inputs3[2].dispatchEvent(new Event('input'));
			inputs3[3].value = 'Jun 28, 2027';
			inputs3[3].dispatchEvent(new Event('input'));
			inputs3[4].value = 'Jun 30, 2027';
			inputs3[4].dispatchEvent(new Event('input'));
			inputs3[5].value = 'Feb 4, 2027';
			inputs3[5].dispatchEvent(new Event('input'));
			Array.from(modal3.contentEl.querySelectorAll('button'))
				.find((b) => b.textContent === 'Save')!
				.click();

			expect(submitted[1]).toEqual({
				acronym: 'CHIL 2027',
				fullName: 'CHIL 2027',
				location: 'Boston, MA',
				start: 'Jun 28, 2027',
				end: 'Jun 30, 2027',
				submissionDdl: 'Feb 4, 2027',
				source: 'manual',
			});
		});
	});
});
