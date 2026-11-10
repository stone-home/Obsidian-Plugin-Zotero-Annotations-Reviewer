import { requestUrl } from 'obsidian';
import { PaperDigestView } from './digest-view';

type El = HTMLElement & Record<string, any>;

function enhance(el: HTMLElement): El {
	const node = el as El;
	const make = (tag: string, options?: any) => {
		const child = enhance(document.createElement(tag));
		if (options?.cls) child.className = options.cls;
		if (options?.text) child.textContent = options.text;
		if (options?.href) child.setAttribute('href', options.href);
		if (options?.value !== undefined) child.setAttribute('value', options.value);
		for (const [key, value] of Object.entries(options?.attr ?? {})) {
			child.setAttribute(key, String(value));
		}
		node.appendChild(child);
		return child;
	};
	node.createDiv = (options?: any) => make('div', options);
	node.createSpan = (options?: any) => make('span', options);
	node.createEl = (tag: string, options?: any) => make(tag, options);
	node.empty = () => {
		node.innerHTML = '';
	};
	node.addClass = (cls: string) => node.classList.add(cls);
	node.toggleClass = (cls: string, on: boolean) => node.classList.toggle(cls, on);
	node.setAttr = (key: string, value: string) => node.setAttribute(key, value);
	return node;
}

const COLLECTIONS = [
	{ key: 'C1', data: { name: 'Peer Review', parentCollection: false } },
	{ key: 'C2', data: { name: '2026', parentCollection: 'C1' } },
	{ key: 'C3', data: { name: 'Visualisation', parentCollection: false } },
];

function makePlugin(digest: Record<string, unknown>, store: Record<string, unknown>) {
	const disk = new Map<string, string>([
		[
			'plugin/digest-store.json',
			JSON.stringify({ version: 1, records: store, invalid: [] }),
		],
	]);
	const plugin: any = {
		app: {
			scope: {},
			vault: {
				configDir: '.obsidian',
				adapter: {
					exists: async (path: string) => disk.has(path),
					read: async (path: string) => disk.get(path),
					write: async (path: string, text: string) =>
						void disk.set(path, text),
					remove: async (path: string) => void disk.delete(path),
					list: async () => ({ files: [], folders: [] }),
					mkdir: async () => undefined,
				},
			},
		},
		manifest: { dir: 'plugin', id: 'zotero-annotation-reviewer' },
		settings: { zoteroPort: 23119, digest },
		saveSettings: jest.fn(async () => undefined),
	};
	return { plugin, disk };
}

const paper = (key: string, extra: Record<string, unknown> = {}) => ({
	key,
	title: `Title ${key}`,
	doi: `10.1000/${key}`,
	status: 'unchecked',
	added_at: `2026-11-0${key.length}T00:00:00.000Z`,
	...extra,
});

async function openView(
	digest: Record<string, unknown>,
	store: Record<string, unknown>
) {
	const { plugin, disk } = makePlugin(digest, store);
	const view = new PaperDigestView({} as any, plugin) as any;
	view.app = plugin.app;
	view.contentEl = enhance(document.createElement('div'));
	await view.onOpen();
	const root = view.contentEl as El;
	const texts = (selector: string) =>
		Array.from(root.querySelectorAll(selector)).map((el) => el.textContent);
	const click = async (selector: string, text?: string) => {
		const el = Array.from(root.querySelectorAll<HTMLElement>(selector)).find(
			(candidate) => !text || candidate.textContent?.includes(text)
		);
		if (!el) throw new Error(`no element ${selector} ${text ?? ''}`);
		el.click();
		await new Promise((resolve) => setTimeout(resolve, 0));
	};
	const saved = () =>
		JSON.parse(disk.get('plugin/digest-store.json') as string).records;
	return { view, root, texts, click, saved, plugin };
}

describe('PaperDigestView', () => {
	const posted: any[] = [];

	beforeAll(() => {
		Element.prototype.scrollIntoView = jest.fn();
	});

	beforeEach(() => {
		posted.length = 0;
		(requestUrl as jest.Mock).mockImplementation(async (request: any) => {
			const url: string = request.url;
			if (url.endsWith('/collections')) {
				return {
					status: 200,
					headers: { 'Zotero-Server-ID': 'SID' },
					text: JSON.stringify(COLLECTIONS),
				};
			}
			if (url.endsWith('/authorize')) {
				return {
					status: 200,
					headers: {},
					text: '{"key":"k","remember":false}',
				};
			}
			if (url.endsWith('/items')) {
				posted.push(JSON.parse(request.body)[0]);
				return { status: 200, headers: {}, text: '{"success":{"0":"ZK1"}}' };
			}
			if (url.endsWith('/search')) {
				return {
					status: 200,
					headers: {},
					text: JSON.stringify([
						{ itemType: 'preprint', title: 'Looked up', tags: [] },
					]),
				};
			}
			return { status: 404, headers: {}, text: '' };
		});
	});

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

	it('shows a clicked paper and restores a rejected one with Undo', async () => {
		const { click, texts, saved, root } = await openView(
			{},
			{
				a: paper('a'),
				bb: paper('bb', {
					status: 'rejected',
					reject_reason: 'off-topic',
					decided_at: '2026-11-05T00:00:00.000Z',
				}),
			}
		);

		await click('.zotero-digest-list-row', 'Title bb');
		expect(texts('.zotero-digest-title')).toEqual(['Title bb']);
		expect(root.textContent).toContain('Rejected: Off-topic · 2026-11-05');

		await click('.zotero-digest-list-row button', 'Undo');
		expect(saved().bb.status).toBe('unchecked');
		expect(saved().bb.reject_reason).toBeUndefined();
		expect(texts('.zotero-digest-badge')).toEqual(['Unchecked', 'Unchecked']);
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

	it('accepts into several collections without directions when none are defined', async () => {
		const { click, root, saved, plugin } = await openView({}, { a: paper('a') });

		await click('.zotero-digest-actions button', 'Accept');
		expect(root.textContent).toContain('No directions are defined');
		const boxes = root.querySelectorAll<HTMLInputElement>(
			'.zotero-digest-collection input'
		);
		expect(boxes).toHaveLength(3);
		for (const index of [1, 2]) {
			boxes[index].checked = true;
			boxes[index].dispatchEvent(new Event('change'));
		}
		await click('.zotero-digest-actions button', 'Confirm');
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(posted[0]).toEqual({
			itemType: 'preprint',
			title: 'Looked up',
			tags: [],
			collections: ['C2', 'C3'],
		});
		expect(saved().a).toMatchObject({
			status: 'accepted',
			zotero_key: 'ZK1',
			collections: [
				{ key: 'C2', name: 'Peer Review / 2026' },
				{ key: 'C3', name: 'Visualisation' },
			],
		});
		expect(plugin.settings.digest.lastCollectionKeys).toEqual(['C2', 'C3']);
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
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(posted[0].tags).toEqual([{ tag: 'dir/llm-serving' }]);
		expect(saved().a.directions).toEqual(['llm-serving']);
	});

	it('disables triage and explains why when the services are down', async () => {
		(requestUrl as jest.Mock).mockRejectedValue(new Error('refused'));
		const { root } = await openView({}, { a: paper('a') });

		expect(root.textContent).toContain('Zotero is not running');
		expect(root.textContent).toContain('Translation server not reachable');
		const buttons = root.querySelectorAll<HTMLButtonElement>(
			'.zotero-digest-actions button'
		);
		expect(Array.from(buttons).every((button) => button.disabled)).toBe(true);
	});
});
