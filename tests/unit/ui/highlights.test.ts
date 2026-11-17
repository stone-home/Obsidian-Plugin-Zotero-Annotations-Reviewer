import { HighlightModal } from '../../../src/ui/highlights';
import { MyPluginSettings } from '../../../src/types';
import { request, RequestUrlParam, resetObsidianMocks } from '../../__mocks__/obsidian';
import { cloneDefaultSettings } from '../../fixtures/plugin';
import { createTestApp, getNoticeMessages, TestAppHarness } from '../../fixtures/vault';

function mockZoteroRpc(options: {
	annotationsError?: Error;
	metadataError?: Error;
	attachments?: Array<Record<string, unknown>>;
	exportedItem?: Record<string, unknown>;
}): void {
	request.mockImplementation(async (rawParam: RequestUrlParam | string) => {
		const bodyStr =
			typeof rawParam === 'string' ? '{}' : String(rawParam.body ?? '{}');
		const parsed = JSON.parse(bodyStr) as { method?: string };
		if (parsed.method === 'item.search') {
			if (options.annotationsError) {
				throw options.annotationsError;
			}
			return JSON.stringify({ result: [{ library: 'My Library' }] });
		}
		if (parsed.method === 'user.groups') {
			return JSON.stringify({ result: [{ id: 1, name: 'My Library' }] });
		}
		if (parsed.method === 'item.attachments') {
			return JSON.stringify({
				result:
					options.attachments ??
					(options.exportedItem?.attachments as unknown[]) ??
					[],
			});
		}
		if (parsed.method === 'item.export') {
			if (options.metadataError) {
				throw options.metadataError;
			}
			const payload = JSON.stringify({
				items: [options.exportedItem ?? {}],
			});
			return JSON.stringify({ result: ['format', 'extra', payload] });
		}
		return JSON.stringify({ result: null });
	});
}

async function flushUi(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('HighlightModal', () => {
	let harness: TestAppHarness;
	let settings: MyPluginSettings;
	let errorSpy: jest.SpyInstance;
	let logSpy: jest.SpyInstance;

	beforeEach(() => {
		resetObsidianMocks();
		harness = createTestApp();
		settings = cloneDefaultSettings({
			sortProperty: 'pageLabel',
			metadataMapping: [
				{
					label: 'Title',
					zoteroProp: 'title',
					noteProp: 'title',
					enabled: true,
				},
				{
					label: 'Authors',
					zoteroProp: 'creators',
					noteProp: 'authors_str',
					enabled: true,
				},
				{
					label: 'Publisher',
					zoteroProp: 'publisher',
					noteProp: 'publisher',
					enabled: true,
				},
				{
					label: 'Disabled Field',
					zoteroProp: 'volume',
					noteProp: 'volume',
					enabled: false,
				},
			],
		});
		errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		errorSpy.mockRestore();
		logSpy.mockRestore();
	});

	it('displays annotation fetch error when Zotero getAnnotations rejects', async () => {
		mockZoteroRpc({ annotationsError: new Error('Zotero offline') });
		const modal = new HighlightModal(harness.app, settings, 'smith2024');
		await modal.onOpen();

		expect(modal.contentEl.querySelector('.zotero-status')?.textContent).toBe(
			'❌ Error fetching annotations: Zotero offline'
		);
	});

	it('shows Notice when getItemMetadata fails, continues rendering empty state, and triggers Update Paper', async () => {
		const runImport = jest.fn(async () => undefined);
		harness.registerPlugin('obsidian-zotero-desktop-connector', {
			settings: { exportFormats: [{ name: 'Literature' }] },
			runImport,
		});
		mockZoteroRpc({
			metadataError: new Error('Metadata RPC broken'),
			exportedItem: { key: 'ITEM1', attachments: [] },
		});

		const modal = new HighlightModal(harness.app, settings, 'smith2024');
		await modal.onOpen();

		expect(getNoticeMessages()).toContain('Metadata fetch failed, but continuing.');
		expect(modal.contentEl.textContent).toContain('No annotations found.');

		const updateBtn = Array.from(modal.contentEl.querySelectorAll('button')).find(
			(b) => b.textContent === '📥 Update Paper'
		) as HTMLButtonElement;
		updateBtn.click();
		await flushUi();
		expect(runImport).toHaveBeenCalledWith('Literature', 'smith2024');
	});

	it('verifies metadata table against active note via markdown-note-orm, handles no-active-note warning, and logs raw data', async () => {
		const longTitle =
			'A Very Long Academic Paper Title Exceeding Fifty Characters Easily';
		mockZoteroRpc({
			exportedItem: {
				key: 'ITEM2',
				title: longTitle,
				creators: [
					{ firstName: 'Alice', lastName: 'Smith' },
					{ firstName: 'Bob', lastName: 'Jones' },
				],
				publisher: '',
				volume: '99',
				attachments: [],
			},
		});

		// 1. Without active note -> warning & '-' status
		const modalNoActive = new HighlightModal(harness.app, settings, 'smith2024');
		await modalNoActive.onOpen();
		expect(
			modalNoActive.contentEl.querySelector('.zotero-verify-warning')?.textContent
		).toBe('⚠️ No active note found.');
		const cellsNoActive = Array.from(
			modalNoActive.contentEl.querySelectorAll('.zotero-cell-center')
		).map((td) => td.textContent);
		expect(cellsNoActive).toEqual(['-', '-', '-']);

		// Log Raw Data button
		const rawBtn = Array.from(
			modalNoActive.contentEl.querySelectorAll('button')
		).find((b) => b.textContent === '🔍 Log Raw Data') as HTMLButtonElement;
		rawBtn.click();
		await flushUi();
		expect(logSpy).toHaveBeenCalled();
		expect(getNoticeMessages()).toContain('Logged to Console');

		// 2. With active note -> Title matches (✅), Authors mismatches (❌ + Notice), Publisher empty ('-' mismatches empty -> ✅ because '-' !== '')
		const activeNote = harness.addFile(
			'002-Literature/smith2024.md',
			[
				'---',
				`title: "${longTitle}"`,
				'authors_str: "Different Author"',
				'publisher: "-"',
				'---',
				'# Literature Body',
			].join('\n')
		);
		harness.setActiveFile(activeNote);

		const modalWithActive = new HighlightModal(harness.app, settings, 'smith2024');
		await modalWithActive.onOpen();

		expect(
			modalWithActive.contentEl.querySelector('.zotero-verify-target')
				?.textContent
		).toBe('Target: smith2024');

		const valCells = Array.from(
			modalWithActive.contentEl.querySelectorAll('.zotero-metadata-value')
		).map((td) => td.textContent);
		expect(valCells).toEqual([
			`${longTitle.substring(0, 48)}...`,
			'Alice Smith, Bob Jones',
			'-',
		]);

		const verifyBtns = Array.from(
			modalWithActive.contentEl.querySelectorAll('.zotero-cell-center button')
		) as HTMLButtonElement[];
		expect(verifyBtns.map((b) => b.textContent)).toEqual(['✅', '❌', '✅']);
		expect(getNoticeMessages()).toContain('Mismatch for Authors');
	});

	it('sorts annotations numerically by pageLabel and lexically by custom sortProperty, renders image cards, and creates/opens/appends/replaces fleeting notes', async () => {
		const runImport = jest.fn(async () => undefined);
		harness.registerPlugin('obsidian-zotero-desktop-connector', {
			settings: { exportFormats: [{ name: 'Literature' }] },
			runImport,
		});

		const mappedImg = harness.addFile('Assets/mapped-fig.png', 'png-bytes');
		const heuristicImg = harness.addFile(
			'Assets/smith2024-3-x10-y20.png',
			'png-bytes'
		);
		expect(heuristicImg).toBeDefined();

		mockZoteroRpc({
			exportedItem: {
				key: 'ITEM3',
				title: 'Paper Three',
				attachments: [
					{
						itemType: 'attachment',
						key: 'ATT9',
						path: 'storage/ATT9/paper.pdf',
						annotations: [
							{
								key: 'ANN_P10',
								annotationType: 'highlight',
								annotationText: 'Page ten quote',
								annotationComment: 'Ten comment',
								annotationColor: '#ffd400',
								annotationPageLabel: '10',
							},
							{
								key: 'ANN_IMG_MAP',
								annotationType: 'image',
								annotationComment: 'Mapped figure',
								annotationColor: '#2ea8e5',
								annotationPageLabel: '2',
							},
							{
								key: 'ANN_IMG_HEUR',
								annotationType: 'image',
								annotationColor: '#5fb236',
								annotationPageLabel: '3',
								annotationPosition: {
									pageIndex: 2,
									rects: [[10, 20, 100, 120]],
								},
							},
							{
								key: 'ANN_IMG_MISS',
								annotationType: 'ink',
								annotationColor: '#ff6666',
								annotationPageLabel: '12',
							},
						],
					},
				],
			},
		});

		const modal = new HighlightModal(harness.app, settings, 'smith2024', {
			ANN_IMG_MAP: mappedImg.path,
		});
		await modal.onOpen();

		// Numeric pageLabel sort: 2, 3, 10, 12 (not lexical 10, 12, 2, 3!)
		const pageSpans = Array.from(
			modal.contentEl.querySelectorAll('.zotero-footer-left span')
		).map((s) => s.textContent);
		expect(pageSpans).toEqual(['Page 2', 'Page 3', 'Page 10', 'Page 12']);

		// Image cards: mapped image, heuristic image, and missing image placeholder
		const captions = Array.from(
			modal.contentEl.querySelectorAll('.zotero-img-caption')
		).map((c) => c.textContent);
		expect(captions).toEqual(['📷 mapped-fig.png', '📷 smith2024-3-x10-y20.png']);

		const fetchBtn = modal.contentEl.querySelector(
			'.zotero-img-placeholder button'
		) as HTMLButtonElement;
		expect(fetchBtn.textContent).toBe('📥 Fetch');
		fetchBtn.click();
		await flushUi();
		expect(runImport).toHaveBeenCalledWith('Literature', 'smith2024');

		// Fleeting note workflow on Page 10 highlight card (3rd card, index 2)
		const cards = Array.from(
			modal.contentEl.querySelectorAll('.zotero-card')
		) as HTMLElement[];
		const createBtn = cards[2].querySelector(
			'.zotero-footer-right button'
		) as HTMLButtonElement;
		expect(createBtn.textContent).toBe('Create Note');

		createBtn.click();
		await flushUi();
		await flushUi();

		expect(getNoticeMessages()).toContain('Note Created');
		const createdNotes = harness.mockApp.vault
			.getMarkdownFiles()
			.filter((f) => f.path.startsWith('Fleeting Notes/'));
		expect(createdNotes).toHaveLength(1);
		const fleetingPath = createdNotes[0].path;
		expect(harness.getContent(fleetingPath)).toContain('Page ten quote');
		expect(harness.getContent(fleetingPath)).toContain('Ten comment');

		// Re-rendered card now shows Open Note, Replace Note, Append Note
		const updatedCard = modal.contentEl.querySelectorAll(
			'.zotero-card'
		)[2] as HTMLElement;
		const actionBtns = Array.from(
			updatedCard.querySelectorAll('.zotero-footer-right button')
		) as HTMLButtonElement[];
		expect(actionBtns.map((b) => b.textContent)).toEqual([
			'Open Note',
			'Replace Note',
			'Append Note',
		]);

		// Append Note appends content
		actionBtns[2].click();
		await flushUi();
		expect(
			harness.getContent(fleetingPath)!.split('Page ten quote').length - 1
		).toBe(2);

		// Re-open with lexical sortProperty ('color') & test Replace Note + Open Note
		settings.sortProperty = 'color';
		const modalLex = new HighlightModal(harness.app, settings, 'smith2024', {
			ANN_IMG_MAP: mappedImg.path,
		});
		await modalLex.onOpen();

		// Find card with Replace Note
		const exportedFooter = Array.from(
			modalLex.contentEl.querySelectorAll('.zotero-footer-right')
		).find((el) => el.textContent?.includes('Replace Note')) as HTMLElement;
		const lexBtns = Array.from(
			exportedFooter.querySelectorAll('button')
		) as HTMLButtonElement[];

		// Replace Note overwrites back to single quote
		lexBtns[1].click();
		await flushUi();
		expect(
			harness.getContent(fleetingPath)!.split('Page ten quote').length - 1
		).toBe(1);

		// Open Note opens file in leaf
		lexBtns[0].click();
		await flushUi();
		expect(harness.openedFiles.some((f) => f.path === fleetingPath)).toBe(true);
	});
});
