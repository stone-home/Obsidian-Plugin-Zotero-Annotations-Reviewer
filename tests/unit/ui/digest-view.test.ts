import {
	parseCoreNoteContent,
	resolvePaperPaths,
	serializeCoreNoteContent,
} from '../../../src/services/paper-hub';
import { ConnectorModal } from '../../../src/ui/connector-modal';
import {
	getDigestServices,
	openDigest,
	openPaperLibrary,
	PaperDigestView,
	registerDigest,
	updateDigestRibbon,
	VIEW_TYPE_DIGEST,
} from '../../../src/ui/digest-view';
import {
	Platform,
	Plugin as MockPlugin,
	requestUrl,
	RequestUrlParam,
	resetObsidianMocks,
	Scope as MockScope,
	WorkspaceLeaf as MockWorkspaceLeaf,
} from '../../__mocks__/obsidian';
import { createTestPlugin } from '../../fixtures/plugin';
import {
	clearOpenedMenus,
	clearOpenedModals,
	createTestApp,
	getLastOpenedModal,
	getNoticeMessages,
	getOpenedMenus,
} from '../../fixtures/vault';

const COLLECTIONS = [
	{ key: 'C1', data: { name: 'Peer Review', parentCollection: false } },
	{ key: 'C2', data: { name: '2026', parentCollection: 'C1' } },
	{ key: 'C3', data: { name: 'Visualisation', parentCollection: false } },
];

const paper = (key: string, extra: Record<string, unknown> = {}) => ({
	key,
	title: `Title ${key}`,
	doi: `10.1000/${key}`,
	status: 'unchecked',
	added_at: `2026-11-0${key.length}T00:00:00.000Z`,
	...extra,
});

async function flushUi(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('PaperDigestView & Digest registration helpers', () => {
	let posted: Record<string, unknown>[];
	let errorSpy: jest.SpyInstance;

	beforeEach(() => {
		resetObsidianMocks();
		Platform.isDesktopApp = true;
		posted = [];
		errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: jest.fn(async () => undefined) },
			configurable: true,
		});

		requestUrl.mockImplementation(async (raw: RequestUrlParam | string) => {
			const req = typeof raw === 'string' ? { url: raw } : raw;
			const url = req.url;
			if (url.endsWith('/collections')) {
				return {
					status: 200,
					headers: { 'Zotero-Server-ID': 'SID' } as Record<string, string>,
					text: JSON.stringify(COLLECTIONS),
					json: COLLECTIONS,
					arrayBuffer: new ArrayBuffer(0),
				};
			}
			if (url.endsWith('/authorize')) {
				return {
					status: 200,
					headers: {} as Record<string, string>,
					text: '{"key":"k","remember":false}',
					json: { key: 'k', remember: false },
					arrayBuffer: new ArrayBuffer(0),
				};
			}
			if (url.endsWith('/items')) {
				const parsed = JSON.parse(String(req.body ?? '[]')) as Record<
					string,
					unknown
				>[];
				posted.push(parsed[0]);
				return {
					status: 200,
					headers: {} as Record<string, string>,
					text: '{"success":{"0":"ZK1"}}',
					json: { success: { '0': 'ZK1' } },
					arrayBuffer: new ArrayBuffer(0),
				};
			}
			if (url.endsWith('/search')) {
				return {
					status: 200,
					headers: {} as Record<string, string>,
					text: JSON.stringify([
						{ itemType: 'preprint', title: 'Looked up', tags: [] },
					]),
					json: [{ itemType: 'preprint', title: 'Looked up', tags: [] }],
					arrayBuffer: new ArrayBuffer(0),
				};
			}
			return {
				status: 404,
				headers: {} as Record<string, string>,
				text: '',
				json: {},
				arrayBuffer: new ArrayBuffer(0),
			};
		});
	});

	afterEach(() => {
		errorSpy.mockRestore();
	});

	async function openView(
		digestPatch: Record<string, unknown> = {},
		storeRecords: Record<string, unknown> = {},
		invalidLines: unknown[] = []
	) {
		const harness = createTestApp();
		harness.disk.set(
			'plugin/digest-store.json',
			JSON.stringify({
				version: 1,
				records: storeRecords,
				invalid: invalidLines,
			})
		);
		const plugin = createTestPlugin(harness);
		plugin.settings.digest = {
			...(plugin.settings.digest ?? {}),
			...digestPatch,
		} as typeof plugin.settings.digest;
		plugin.saveSettings = jest.fn(async () => undefined);

		const leaf = new MockWorkspaceLeaf();
		const view = new PaperDigestView(
			leaf as unknown as import('obsidian').WorkspaceLeaf,
			plugin
		);
		view.app = harness.app;
		await view.onOpen();

		const root = view.contentEl;
		const texts = (selector: string) =>
			Array.from(root.querySelectorAll(selector)).map(
				(el) => el.textContent ?? ''
			);
		const click = async (selector: string, text?: string) => {
			const el = Array.from(root.querySelectorAll<HTMLElement>(selector)).find(
				(candidate) => !text || candidate.textContent?.includes(text)
			);
			if (!el) throw new Error(`no element ${selector} ${text ?? ''}`);
			el.click();
			await flushUi();
		};
		const saved = () => {
			const raw = harness.disk.get('plugin/digest-store.json') ?? '{}';
			return (
				JSON.parse(raw) as {
					records: Record<string, Record<string, unknown>>;
				}
			).records;
		};
		const fireKey = async (key: string, targetEl?: HTMLElement) => {
			const scope = view.scope as unknown as MockScope;
			const binding = scope.handlers.find((h) => h.key === key);
			if (!binding) throw new Error(`No key binding for ${key}`);
			const evt = new KeyboardEvent('keydown', { key, bubbles: true });
			Object.defineProperty(evt, 'target', {
				value: targetEl ?? root,
			});
			binding.func(evt, null);
			await flushUi();
		};

		return { view, harness, plugin, root, texts, click, saved, fireKey };
	}

	it('lists every paper with its status and an undo for decided ones', async () => {
		const { texts, root } = await openView(
			{},
			{
				a: paper('a'),
				bb: paper('bb', {
					status: 'rejected',
					reject_reason: 'off-topic',
					decided_at: '2026-11-05T00:00:00.000Z',
				}),
				ccc: paper('ccc', {
					status: 'accepted',
					decided_at: '2026-11-06T00:00:00.000Z',
					zotero_key: 'Z',
				}),
			}
		);

		expect(texts('.zotero-digest-list-title')).toEqual([
			'Title a',
			'Title ccc',
			'Title bb',
		]);
		expect(texts('.zotero-digest-badge')).toEqual([
			'Unchecked',
			'Accepted',
			'Rejected',
		]);
		expect(root.querySelectorAll('.zotero-digest-list-row button')).toHaveLength(2);
		expect(texts('.zotero-digest-title')).toEqual(['Title a']);
	});

	it('shows a clicked paper and restores rejected and accepted papers with Undo', async () => {
		const { click, texts, saved, root } = await openView(
			{},
			{
				a: paper('a'),
				bb: paper('bb', {
					status: 'rejected',
					reject_reason: 'off-topic',
					decided_at: '2026-11-05T00:00:00.000Z',
				}),
				cc: paper('cc', {
					status: 'accepted',
					zotero_key: 'ZK9',
					decided_at: '2026-11-06T00:00:00.000Z',
				}),
			}
		);

		await click('.zotero-digest-list-row', 'Title bb');
		expect(texts('.zotero-digest-title')).toEqual(['Title bb']);
		expect(root.textContent).toContain('Rejected: Off-topic · 2026-11-05');

		await click('.zotero-digest-panel button', 'Undo');
		expect(saved().bb.status).toBe('unchecked');
		expect(saved().bb.reject_reason).toBeUndefined();

		// Undo on accepted paper shows Zotero non-removal Notice
		await click('.zotero-digest-list-row', 'Title cc');
		expect(root.textContent).toContain('Show in Zotero');
		await click('.zotero-digest-panel button', 'Undo');
		expect(saved().cc.status).toBe('unchecked');
		expect(
			getNoticeMessages().some((m) =>
				m.includes('The item already created in Zotero was not removed.')
			)
		).toBe(true);
	});

	it('rejects with a reason and moves to the next unchecked paper', async () => {
		const { click, texts, saved } = await openView(
			{},
			{ a: paper('a'), bb: paper('bb') }
		);

		await click('.zotero-digest-actions button', 'Reject');
		await click('.zotero-digest-chip', 'Low quality');

		expect(saved().a).toMatchObject({
			status: 'rejected',
			reject_reason: 'low-quality',
		});
		expect(texts('.zotero-digest-title')).toEqual(['Title bb']);
	});

	it('accepts into the one chosen collection and keeps the list position', async () => {
		const { click, root, saved, plugin } = await openView({}, { a: paper('a') });

		await click('.zotero-digest-actions button', 'Accept');
		expect(root.textContent).toContain('No directions are defined');
		const radios = () =>
			root.querySelectorAll<HTMLInputElement>('.zotero-digest-collection input');
		expect(Array.from(radios()).map((input) => input.type)).toEqual([
			'radio',
			'radio',
			'radio',
			'radio',
		]);
		expect(radios()[0].checked).toBe(true);
		const box = root.querySelector('.zotero-digest-collections') as HTMLElement;
		radios()[2].checked = true;
		radios()[2].dispatchEvent(new Event('change'));
		expect(root.querySelector('.zotero-digest-collections')).toBe(box);

		await click('.zotero-digest-actions button', 'Confirm');
		await flushUi();

		expect(posted[0]).toEqual({
			itemType: 'preprint',
			title: 'Looked up',
			tags: [],
			collections: ['C2'],
		});
		expect(saved().a).toMatchObject({
			status: 'accepted',
			zotero_key: 'ZK1',
			collections: [{ key: 'C2', name: 'Peer Review / 2026' }],
		});
		expect(plugin.settings.digest?.lastCollectionKeys).toEqual(['C2']);
	});

	it('offers a manual import when the lookup finds nothing, and writes nothing', async () => {
		requestUrl.mockImplementation(async (raw: RequestUrlParam | string) => {
			const req = typeof raw === 'string' ? { url: raw } : raw;
			if (req.url.endsWith('/collections')) {
				return {
					status: 200,
					headers: { 'Zotero-Server-ID': 'SID' } as Record<string, string>,
					text: JSON.stringify(COLLECTIONS),
					json: COLLECTIONS,
					arrayBuffer: new ArrayBuffer(0),
				};
			}
			if (req.url.endsWith('/search')) {
				return {
					status: 501,
					headers: {} as Record<string, string>,
					text: 'No items returned from any translator',
					json: {},
					arrayBuffer: new ArrayBuffer(0),
				};
			}
			return {
				status: 404,
				headers: {} as Record<string, string>,
				text: '',
				json: {},
				arrayBuffer: new ArrayBuffer(0),
			};
		});
		const { click, root, texts, saved } = await openView({}, { a: paper('a') });

		await click('.zotero-digest-actions button', 'Accept');
		expect(root.textContent).not.toContain('Accept, import manually');
		await click('.zotero-digest-actions button', 'Confirm');
		await flushUi();

		expect(texts('.zotero-digest-error')).toEqual([
			'Lookup found nothing for 10.1000/a. Nothing was added to Zotero.',
		]);
		expect(saved().a.status).toBe('unchecked');

		await click('.zotero-digest-actions button', 'Accept, import manually');

		expect(posted).toHaveLength(0);
		expect(saved().a).toMatchObject({
			status: 'accepted',
			manual_import: true,
		});
		expect(saved().a.zotero_key).toBeUndefined();
		expect(texts('.zotero-digest-badge')).toEqual(['Accepted · manual']);
		expect(root.textContent).toContain('Accepted, to import manually');
	});

	it('requires a direction when directions are defined, then writes its tag', async () => {
		const { click, texts, saved } = await openView(
			{ directions: [{ id: '', label: 'LLM Serving' }] },
			{ a: paper('a') }
		);

		await click('.zotero-digest-actions button', 'Accept');
		await click('.zotero-digest-actions button', 'Confirm');
		expect(texts('.zotero-digest-error')).toEqual([
			'Pick at least one direction above, then confirm.',
		]);
		expect(posted).toHaveLength(0);

		await click('.zotero-digest-chip', 'LLM Serving');
		expect(texts('.zotero-digest-error')).toEqual([]);
		await click('.zotero-digest-actions button', 'Confirm');
		await flushUi();

		expect(posted[0].tags).toEqual([{ tag: 'dir/llm-serving' }]);
		expect(saved().a.directions).toEqual(['llm-serving']);
	});

	it('disables triage when services are down or disabled and recovers on Recheck', async () => {
		requestUrl.mockRejectedValueOnce(new Error('refused'));
		requestUrl.mockRejectedValueOnce(new Error('refused'));
		const { root, click } = await openView({}, { a: paper('a') });

		expect(root.textContent).toContain('Zotero is not running');
		expect(root.textContent).toContain('Translation server not reachable');
		const buttons = root.querySelectorAll<HTMLButtonElement>(
			'.zotero-digest-actions button'
		);
		expect(Array.from(buttons).every((button) => button.disabled)).toBe(true);

		// Clicking Recheck re-probes services (now online via default mockImplementation)
		await click('.zotero-digest-alert button', 'Recheck');
		expect(root.querySelector('.zotero-digest-alert')).toBeNull();
		const onlineBtns = root.querySelectorAll<HTMLButtonElement>(
			'.zotero-digest-actions button'
		);
		expect(Array.from(onlineBtns).every((button) => !button.disabled)).toBe(true);
	});

	it('displays "Paper House" and renders segmented tabs in [Digest, Library] order with Digest active by default', async () => {
		const { view, root, texts } = await openView({}, { a: paper('a') });

		expect(view.getViewType()).toBe(VIEW_TYPE_DIGEST);
		expect(view.getIcon()).toBe('inbox');
		expect(view.getDisplayText()).toBe('Paper House');
		expect(texts('.zotero-hub-seg-btn')).toEqual(['Digest', 'Library']);

		const segButtons = Array.from(
			root.querySelectorAll<HTMLButtonElement>('.zotero-hub-seg-btn')
		);
		expect(segButtons[0].classList.contains('is-active')).toBe(true);
		expect(segButtons[1].classList.contains('is-active')).toBe(false);
	});

	it('supports Digest status/batch filters, More menu (Refresh, Import .bib, Invalid lines, Withdraw batch), and keyboard shortcuts', async () => {
		const { harness, root, texts, click, saved, fireKey } = await openView(
			{
				incomingFolder: 'Digest/Incoming',
				directions: [{ id: 'sys', label: 'Systems' }],
			},
			{
				a: paper('a', { batch: 'bib-run1' }),
				bb: paper('bb', { batch: 'bib-run2' }),
			},
			[
				{
					raw: '{bad json',
					reason: 'Not valid JSON',
					file: 'bad.jsonl',
					at: '2026-11-01T00:00:00.000Z',
				},
			]
		);

		// Keyboard navigation & shortcuts in Digest
		await fireKey('ArrowDown');
		expect(texts('.zotero-digest-title')).toEqual(['Title bb']);
		await fireKey('ArrowUp');
		expect(texts('.zotero-digest-title')).toEqual(['Title a']);

		// Keyboard ignored when target is an INPUT element
		const dummyInput = document.createElement('input');
		await fireKey('ArrowDown', dummyInput);
		expect(texts('.zotero-digest-title')).toEqual(['Title a']);

		// ArrowRight -> startAccept, digit '1' -> pick direction, Escape -> cancel back to card
		await fireKey('ArrowRight');
		expect(root.textContent).toContain('Confirm (Enter)');
		await fireKey('1');
		expect(
			root.querySelector('.zotero-digest-chip.is-picked')?.textContent
		).toContain('Systems');
		await fireKey('Escape');
		expect(root.textContent).not.toContain('Confirm (Enter)');

		// ArrowLeft -> startReject, digit '1' -> reject with first reason
		await fireKey('ArrowLeft');
		expect(root.textContent).toContain('Reject: reason');
		await fireKey('1');
		expect(saved().a.status).toBe('rejected');

		// Status filter dropdown
		const selects = Array.from(
			root.querySelectorAll<HTMLSelectElement>(
				'.zotero-digest-header-right select'
			)
		);
		selects[0].value = 'rejected';
		selects[0].dispatchEvent(new Event('change'));
		expect(texts('.zotero-digest-list-title')).toEqual(['Title a']);

		selects[0].value = 'all';
		selects[0].dispatchEvent(new Event('change'));

		// Batch filter dropdown -> select 'bib-run2' and Withdraw via More menu
		const batchSelect = root.querySelectorAll<HTMLSelectElement>(
			'.zotero-digest-header-right select'
		)[1];
		batchSelect.value = 'bib-run2';
		batchSelect.dispatchEvent(new Event('change'));
		expect(texts('.zotero-digest-list-title')).toEqual(['Title bb']);

		clearOpenedMenus();
		await click('button[aria-label="More"]');
		const menu1 = getOpenedMenus()[0];
		expect(menu1.items.map((item) => item.title)).toEqual([
			'Refresh',
			'Import .bib',
			'Invalid lines (1)',
			'Withdraw import: bib-run2',
		]);
		menu1.items[3].trigger();
		await flushUi();
		expect(saved().bb).toBeUndefined();

		// Refresh from More menu imports incoming JSONL
		harness.disk.set(
			'Digest/Incoming/drop.jsonl',
			JSON.stringify({
				key: '10.1000/drop',
				title: 'Dropped Paper',
				doi: '10.1000/drop',
			})
		);
		clearOpenedMenus();
		await click('button[aria-label="More"]');
		getOpenedMenus()[0].items[0].trigger();
		await flushUi();
		expect(saved()['10.1000/drop']?.title).toBe('Dropped Paper');

		// Invalid lines view -> Clear -> Back
		clearOpenedMenus();
		await click('button[aria-label="More"]');
		getOpenedMenus()[0].items[2].trigger();
		await flushUi();
		expect(root.textContent).toContain('bad.jsonl: Not valid JSON');
		await click('.zotero-digest-list-bar button', 'Clear');
		expect(root.textContent).toContain('None.');
		await click('.zotero-digest-list-bar button', '← Back');
		expect(texts('.zotero-digest-list-title')).toContain('Dropped Paper');

		// Import .bib via hidden file input
		clearOpenedMenus();
		await click('button[aria-label="More"]');
		// Intercept file input before onchange removes it
		const createElSpy = jest.spyOn(root, 'createEl');
		getOpenedMenus()[0].items[1].trigger();
		const fileInput = createElSpy.mock.results.find(
			(r) => (r.value as HTMLElement)?.getAttribute?.('type') === 'file'
		)?.value as HTMLInputElement;
		createElSpy.mockRestore();
		const bibFile = {
			name: 'refs.bib',
			text: async () =>
				'@article{k2026, title={Bib Imported}, doi={10.1000/bib1}, year={2026}}',
		} as unknown as File;
		Object.defineProperty(fileInput, 'files', { value: [bibFile] });
		fileInput.dispatchEvent(new Event('change'));
		await flushUi();
		expect(saved()['10.1000/bib1']?.title).toBe('Bib Imported');
	});

	it('renders "Open Note" without Enter binding in Library tab, mutually exclusive Core Note actions, search/filters, copy/connect actions, and live Vault refresh', async () => {
		const { harness, plugin, root, texts, click, fireKey } = await openView({}, {});

		// Empty library state first
		await click('.zotero-hub-seg-btn', 'Library');
		expect(root.textContent).toContain('No papers in Vault yet.');

		const alphaFile = harness.addFile('002-Literature/alpha2025.md', '', {
			'citation-key': 'alpha2025',
			title: 'Alpha Systems Paper',
			authors: ['Alice-Smith'],
			venue: '[[OSDI Series]]',
			year: 2025,
			doi: '10.1145/alpha',
			code: 'https://github.com/org/alpha',
			projects: ['[[004-Projects/Sys/Dashboard|SYS]]'],
			type: 'literature',
		});
		const alphaPaths = resolvePaperPaths(
			plugin.settings.paperWorkspace,
			'alpha2025'
		);
		harness.addFile(
			alphaPaths.takeaway,
			[
				'## 📊 Research Profile',
				'- 💊 **TL;DR**:: Alpha fast kernel path.',
				'- ✅ **contributions**:: Ring buffer.',
			].join('\n')
		);

		harness.addFile('002-Literature/beta2024.md', '', {
			'citation-key': 'beta2024',
			title: 'Beta Storage Paper',
			venue: '[[SOSP Series]]',
			year: 2024,
			type: 'literature',
		});
		const betaCoreFile = harness.addFile(
			'002-Literature/104-Paper Notes/beta2024.md',
			serializeCoreNoteContent({
				citekey: 'beta2024',
				source: '[[002-Literature/beta2024|beta2024]]',
				projects: [],
				linkedNotes: ['[[A - Storage - LSM]]'],
				body: 'Existing core synthesis body.',
			}),
			{ 'citation-key': 'beta2024', type: 'paper-note' }
		);

		// Click Refresh in Library header
		await click('.zotero-library-refresh-btn');
		expect(texts('.zotero-library-row .zotero-digest-list-title')).toEqual([
			'Alpha Systems Paper',
			'Beta Storage Paper',
		]);

		// Action button says "Open Note", never "Open Note (Enter)"
		const actionTexts = texts('.zotero-library-actions button');
		expect(actionTexts).toContain('Open Note');
		expect(actionTexts).not.toContain('Open Note (Enter)');

		// Pressing Enter in Library does NOT open the selected note
		await fireKey('Enter');
		expect(harness.openedFiles).toHaveLength(0);

		// Clicking "Open Note" opens alphaFile
		await click('.zotero-library-actions button', 'Open Note');
		expect(harness.openedFiles).toEqual([alphaFile]);
		harness.openedFiles.length = 0;

		// Copy [[Wikilink]], Copy citekey, Connect Notes
		await click('.zotero-library-actions button', 'Copy [[Wikilink]]');
		expect(getNoticeMessages()).toContain('Copied [[alpha2025]]');
		await click('.zotero-library-actions button', 'Copy citekey');
		expect(getNoticeMessages()).toContain('Copied alpha2025');

		clearOpenedModals();
		await click('.zotero-library-actions button', 'Connect Notes');
		expect(getLastOpenedModal()).toBeInstanceOf(ConnectorModal);

		// Research Profile & Project chip rendered on alpha2025
		expect(root.textContent).toContain('Takeaway Research Profile');
		expect(root.textContent).toContain('Alpha fast kernel path.');
		await click('.zotero-library-links-card a.zotero-link-chip', 'SYS');
		expect(harness.openedLinks).toContainEqual({
			linktext: '004-Projects/Sys/Dashboard',
			sourcePath: alphaFile.path,
		});

		// Mutually exclusive Core Note buttons:
		// 1. alpha2025 has no Core Note -> ONLY "Write Core Note"
		expect(texts('.zotero-library-core-card button')).toEqual(['Write Core Note']);

		// 2. beta2024 has Core Note -> ONLY "Open"
		await fireKey('ArrowDown');
		expect(texts('.zotero-library-core-card button')).toEqual(['Open']);
		await click('.zotero-library-core-card button', 'Open');
		expect(harness.openedFiles).toEqual([betaCoreFile]);
		harness.openedFiles.length = 0;

		// 3. Write Core Note on alpha2025 creates Core Note and switches exclusively to "Open"
		await fireKey('ArrowUp');
		await click('.zotero-library-core-card button', 'Write Core Note');
		expect(
			parseCoreNoteContent(harness.getContent(alphaPaths.coreNote)!).citekey
		).toBe('alpha2025');
		expect(texts('.zotero-library-core-card button')).toEqual(['Open']);

		// Venue pill filter + Escape clears venue/search filters
		await click('.zotero-library-venue-pill', 'OSDI');
		expect(texts('.zotero-library-row .zotero-digest-list-title')).toEqual([
			'Alpha Systems Paper',
		]);
		await fireKey('Escape');
		expect(texts('.zotero-library-row .zotero-digest-list-title')).toHaveLength(2);

		// Search input + Clear search button + Quick filters
		const searchInput = root.querySelector(
			'.zotero-library-search-input'
		) as HTMLInputElement;
		searchInput.value = 'nonexistent-query';
		searchInput.dispatchEvent(new Event('input'));
		await flushUi();
		expect(root.textContent).toContain('No matching papers in Vault.');

		await click('.zotero-library-search-clear');
		expect(texts('.zotero-library-row .zotero-digest-list-title')).toHaveLength(2);

		await click('.zotero-library-filter-chip', 'Takeaway');
		expect(texts('.zotero-library-row .zotero-digest-list-title')).toEqual([
			'Alpha Systems Paper',
		]);
		await click('.zotero-library-filter-chip', 'All');

		// Live Vault create event auto-refreshes Library list
		await harness.app.vault.create(
			'002-Literature/gamma2026.md',
			'---\ncitation-key: gamma2026\ntitle: Gamma Live Paper\nyear: 2026\ntype: literature\n---\n'
		);
		await flushUi();
		expect(texts('.zotero-library-row .zotero-digest-list-title')).toContain(
			'Gamma Live Paper'
		);
	});

	it('registers Digest commands/views/ribbon on desktop, skips on mobile, and supports secretStorage + fallback key storage', async () => {
		const harness = createTestApp();
		const plugin = createTestPlugin(harness);
		plugin.saveSettings = jest.fn(async () => undefined);

		// Mobile guard: registerDigest & updateDigestRibbon are no-ops
		Platform.isDesktopApp = false;
		registerDigest(plugin);
		updateDigestRibbon(plugin);
		expect((plugin as unknown as MockPlugin).commands).toHaveLength(0);
		expect((plugin as unknown as MockPlugin).ribbonIcons).toHaveLength(0);

		// Desktop registration
		Platform.isDesktopApp = true;
		registerDigest(plugin);
		const mockPlugin = plugin as unknown as MockPlugin;
		expect(mockPlugin.commands.map((c) => c.id)).toEqual([
			'open-paper-digest',
			'open-paper-library',
		]);
		expect(mockPlugin.ribbonIcons).toHaveLength(1);

		// openDigest and openPaperLibrary reuse popout leaf
		await openDigest(plugin);
		expect(
			harness.mockApp.workspace.getLeavesOfType(VIEW_TYPE_DIGEST)
		).toHaveLength(1);

		await openPaperLibrary(plugin, 'OSDI');
		expect(
			harness.mockApp.workspace.getLeavesOfType(VIEW_TYPE_DIGEST)
		).toHaveLength(1);

		// SecretStorage key read/write via ZoteroLocalClient authorize
		const harnessNoSecrets = createTestApp();
		Reflect.set(harnessNoSecrets.mockApp, 'secretStorage', undefined);
		const pluginNoSecrets = createTestPlugin(harnessNoSecrets);
		pluginNoSecrets.saveSettings = jest.fn(async () => undefined);
		requestUrl.mockImplementationOnce(async () => ({
			status: 200,
			headers: { 'Zotero-Server-ID': 'SID' },
			text: '[]',
			json: [],
			arrayBuffer: new ArrayBuffer(0),
		}));
		requestUrl.mockImplementationOnce(async () => ({
			status: 200,
			headers: {},
			text: '{"key":"saved-in-settings","remember":true}',
			json: {},
			arrayBuffer: new ArrayBuffer(0),
		}));
		requestUrl.mockImplementationOnce(async () => ({
			status: 200,
			headers: {},
			text: '{"success":{"0":"ZK99"}}',
			json: {},
			arrayBuffer: new ArrayBuffer(0),
		}));
		const svcFallback = getDigestServices(pluginNoSecrets);
		await svcFallback.zotero.createItem({ itemType: 'preprint', title: 'X' });
		expect(pluginNoSecrets.settings.digest?.zoteroApiKey).toBe('saved-in-settings');
	});
});
