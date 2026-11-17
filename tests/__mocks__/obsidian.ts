export interface DomElementInfo {
	cls?: string | string[];
	text?: string | DocumentFragment;
	attr?: Record<string, string | number | boolean | null>;
	title?: string;
	parent?: Node;
	value?: string;
	type?: string;
	prepend?: boolean;
	placeholder?: string;
	href?: string;
}

export interface RequestUrlParam {
	url: string;
	method?: string;
	contentType?: string;
	body?: string | ArrayBuffer;
	headers?: Record<string, string>;
	throw?: boolean;
}

export interface RequestUrlResponse {
	status: number;
	headers: Record<string, string>;
	arrayBuffer: ArrayBuffer;
	json: unknown;
	text: string;
}

export interface EventRef {
	eventName: string;
	callback: (...data: unknown[]) => unknown;
}

export interface FileStats {
	ctime: number;
	mtime: number;
	size: number;
}

export interface FuzzyMatch<T> {
	item: T;
	match: {
		score: number;
		matches: Array<[number, number]>;
	};
}

export interface Command {
	id: string;
	name: string;
	icon?: string;
	callback?: () => unknown;
	checkCallback?: (checking: boolean) => boolean | void;
}

export interface PluginManifest {
	dir?: string;
	id: string;
	name: string;
	author: string;
	version: string;
	minAppVersion: string;
	description: string;
	authorUrl?: string;
	isDesktopOnly?: boolean;
}

export interface CachedMetadata {
	frontmatter?: Record<string, unknown>;
}

import type { MarkdownPostProcessorContext as ObsidianPostProcessorContext } from 'obsidian';

export type MarkdownPostProcessorContext = ObsidianPostProcessorContext;

function splitClasses(input: string | string[] | undefined): string[] {
	if (!input) return [];
	const list = Array.isArray(input) ? input : [input];
	const tokens: string[] = [];
	for (const entry of list) {
		for (const part of entry.split(/\s+/)) {
			if (part) tokens.push(part);
		}
	}
	return tokens;
}

function applyDomInfo(el: HTMLElement, o?: DomElementInfo | string): void {
	if (!o) return;
	if (typeof o === 'string') {
		const tokens = splitClasses(o);
		if (tokens.length > 0) el.classList.add(...tokens);
		return;
	}
	const tokens = splitClasses(o.cls);
	if (tokens.length > 0) el.classList.add(...tokens);
	if (o.text !== undefined) {
		if (typeof o.text === 'string') {
			el.textContent = o.text;
		} else {
			el.textContent = '';
			el.appendChild(o.text);
		}
	}
	if (o.title !== undefined) {
		el.setAttribute('title', o.title);
	}
	if (o.href !== undefined) {
		el.setAttribute('href', o.href);
	}
	if (o.type !== undefined) {
		el.setAttribute('type', o.type);
		if (el instanceof HTMLInputElement) {
			el.type = o.type;
		}
	}
	if (o.placeholder !== undefined) {
		el.setAttribute('placeholder', o.placeholder);
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
			el.placeholder = o.placeholder;
		}
	}
	if (o.value !== undefined) {
		el.setAttribute('value', o.value);
		if (
			el instanceof HTMLInputElement ||
			el instanceof HTMLTextAreaElement ||
			el instanceof HTMLOptionElement ||
			el instanceof HTMLSelectElement
		) {
			el.value = o.value;
		}
	}
	if (o.attr) {
		for (const [key, val] of Object.entries(o.attr)) {
			if (val === null) {
				el.removeAttribute(key);
			} else {
				el.setAttribute(key, String(val));
			}
		}
	}
}

export function installDomPolyfills(): void {
	if (typeof document === 'undefined') return;

	const nodeProto = Node.prototype as Node & {
		empty?: () => void;
		detach?: () => void;
		appendText?: (val: string) => void;
		createEl?: <K extends keyof HTMLElementTagNameMap>(
			tag: K,
			o?: DomElementInfo | string,
			callback?: (el: HTMLElementTagNameMap[K]) => void
		) => HTMLElementTagNameMap[K];
		createDiv?: (
			o?: DomElementInfo | string,
			callback?: (el: HTMLDivElement) => void
		) => HTMLDivElement;
		createSpan?: (
			o?: DomElementInfo | string,
			callback?: (el: HTMLSpanElement) => void
		) => HTMLSpanElement;
	};

	if (typeof nodeProto.empty !== 'function') {
		nodeProto.empty = function (this: Node): void {
			while (this.firstChild) {
				this.removeChild(this.firstChild);
			}
		};
	}

	if (typeof nodeProto.detach !== 'function') {
		nodeProto.detach = function (this: Node): void {
			this.parentNode?.removeChild(this);
		};
	}

	if (typeof nodeProto.appendText !== 'function') {
		nodeProto.appendText = function (this: Node, val: string): void {
			this.appendChild(document.createTextNode(val));
		};
	}

	if (typeof nodeProto.createEl !== 'function') {
		nodeProto.createEl = function <K extends keyof HTMLElementTagNameMap>(
			this: Node,
			tag: K,
			o?: DomElementInfo | string,
			callback?: (el: HTMLElementTagNameMap[K]) => void
		): HTMLElementTagNameMap[K] {
			const el = document.createElement(tag);
			applyDomInfo(el, o);
			if (callback) callback(el);
			const targetParent =
				typeof o === 'object' && o !== null && o.parent ? o.parent : this;
			if (
				typeof o === 'object' &&
				o !== null &&
				o.prepend &&
				'prepend' in targetParent &&
				typeof (targetParent as ParentNode).prepend === 'function'
			) {
				(targetParent as ParentNode).prepend(el);
			} else {
				targetParent.appendChild(el);
			}
			return el;
		};
	}

	if (typeof nodeProto.createDiv !== 'function') {
		nodeProto.createDiv = function (
			this: Node,
			o?: DomElementInfo | string,
			callback?: (el: HTMLDivElement) => void
		): HTMLDivElement {
			return (this as HTMLElement).createEl('div', o, callback);
		};
	}

	if (typeof nodeProto.createSpan !== 'function') {
		nodeProto.createSpan = function (
			this: Node,
			o?: DomElementInfo | string,
			callback?: (el: HTMLSpanElement) => void
		): HTMLSpanElement {
			return (this as HTMLElement).createEl('span', o, callback);
		};
		}

	const elProto = Element.prototype as Element & {
		getText?: () => string;
		setText?: (val: string | DocumentFragment) => void;
		addClass?: (...classes: string[]) => void;
		addClasses?: (classes: string[]) => void;
		removeClass?: (...classes: string[]) => void;
		removeClasses?: (classes: string[]) => void;
		toggleClass?: (classes: string | string[], value: boolean) => void;
		hasClass?: (cls: string) => boolean;
		setAttr?: (
			qualifiedName: string,
			value: string | number | boolean | null
		) => void;
		setAttrs?: (obj: Record<string, string | number | boolean | null>) => void;
		getAttr?: (qualifiedName: string) => string | null;
		find?: (selector: string) => HTMLElement | null;
		findAll?: (selector: string) => HTMLElement[];
		scrollIntoView?: (arg?: boolean | ScrollIntoViewOptions) => void;
	};

	if (typeof elProto.getText !== 'function') {
		elProto.getText = function (this: Element): string {
			return this.textContent ?? '';
		};
	}

	if (typeof elProto.setText !== 'function') {
		elProto.setText = function (
			this: Element,
			val: string | DocumentFragment
		): void {
			if (typeof val === 'string') {
				this.textContent = val;
			} else {
				(this as HTMLElement).empty();
				this.appendChild(val);
			}
		};
	}

	if (typeof elProto.addClass !== 'function') {
		elProto.addClass = function (this: Element, ...classes: string[]): void {
			const tokens = splitClasses(classes);
			if (tokens.length > 0) this.classList.add(...tokens);
		};
	}

	if (typeof elProto.addClasses !== 'function') {
		elProto.addClasses = function (this: Element, classes: string[]): void {
			const tokens = splitClasses(classes);
			if (tokens.length > 0) this.classList.add(...tokens);
		};
	}

	if (typeof elProto.removeClass !== 'function') {
		elProto.removeClass = function (this: Element, ...classes: string[]): void {
			const tokens = splitClasses(classes);
			if (tokens.length > 0) this.classList.remove(...tokens);
		};
	}

	if (typeof elProto.removeClasses !== 'function') {
		elProto.removeClasses = function (this: Element, classes: string[]): void {
			const tokens = splitClasses(classes);
			if (tokens.length > 0) this.classList.remove(...tokens);
		};
	}

	if (typeof elProto.toggleClass !== 'function') {
		elProto.toggleClass = function (
			this: Element,
			classes: string | string[],
			value: boolean
		): void {
			for (const cls of splitClasses(classes)) {
				this.classList.toggle(cls, value);
			}
		};
	}

	if (typeof elProto.hasClass !== 'function') {
		elProto.hasClass = function (this: Element, cls: string): boolean {
			return this.classList.contains(cls);
		};
	}

	if (typeof elProto.setAttr !== 'function') {
		elProto.setAttr = function (
			this: Element,
			qualifiedName: string,
			value: string | number | boolean | null
		): void {
			if (value === null) {
				this.removeAttribute(qualifiedName);
			} else {
				this.setAttribute(qualifiedName, String(value));
			}
		};
	}

	if (typeof elProto.setAttrs !== 'function') {
		elProto.setAttrs = function (
			this: Element,
			obj: Record<string, string | number | boolean | null>
		): void {
			for (const [k, v] of Object.entries(obj)) {
				(this as HTMLElement).setAttr(k, v);
			}
		};
	}

	if (typeof elProto.getAttr !== 'function') {
		elProto.getAttr = function (this: Element, qualifiedName: string): string | null {
			return this.getAttribute(qualifiedName);
		};
	}

	if (typeof elProto.find !== 'function') {
		elProto.find = function (this: Element, selector: string): HTMLElement | null {
			return this.querySelector<HTMLElement>(selector);
		};
	}

	if (typeof elProto.findAll !== 'function') {
		elProto.findAll = function (this: Element, selector: string): HTMLElement[] {
			return Array.from(this.querySelectorAll<HTMLElement>(selector));
		};
	}

	if (typeof elProto.scrollIntoView !== 'function') {
		elProto.scrollIntoView = function (): void {
			// No-op in jsdom
		};
	}

	const htmlProto = HTMLElement.prototype as HTMLElement & {
		setCssProps?: (props: Record<string, string>) => void;
		setCssStyles?: (styles: Partial<CSSStyleDeclaration>) => void;
		show?: () => void;
		hide?: () => void;
		toggle?: (show: boolean) => void;
	};

	if (typeof htmlProto.setCssProps !== 'function') {
		htmlProto.setCssProps = function (
			this: HTMLElement,
			props: Record<string, string>
		): void {
			for (const [k, v] of Object.entries(props)) {
				this.style.setProperty(k, v);
			}
		};
	}

	if (typeof htmlProto.setCssStyles !== 'function') {
		htmlProto.setCssStyles = function (
			this: HTMLElement,
			styles: Partial<CSSStyleDeclaration>
		): void {
			Object.assign(this.style, styles);
		};
	}

	if (typeof htmlProto.show !== 'function') {
		htmlProto.show = function (this: HTMLElement): void {
			this.style.display = '';
		};
	}

	if (typeof htmlProto.hide !== 'function') {
		htmlProto.hide = function (this: HTMLElement): void {
			this.style.display = 'none';
		};
	}

	if (typeof htmlProto.toggle !== 'function') {
		htmlProto.toggle = function (this: HTMLElement, show: boolean): void {
			this.style.display = show ? '' : 'none';
		};
	}

	if (!('innerText' in HTMLElement.prototype)) {
		Object.defineProperty(HTMLElement.prototype, 'innerText', {
			configurable: true,
			get(this: HTMLElement): string {
				return this.textContent ?? '';
			},
			set(this: HTMLElement, value: string): void {
				this.textContent = value;
			},
		});
	}

	const g = globalThis as unknown as { sleep?: (ms: number) => Promise<void> };
	if (typeof g.sleep !== 'function') {
		g.sleep = (): Promise<void> => Promise.resolve();
	}
}

installDomPolyfills();

export function normalizePath(path: string): string {
	if (!path) return '';
	return path
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
		.replace(/^\.\//, '')
		.replace(/^\/+/, '');
}

export class Events {
	private listeners = new Map<string, Set<(...data: unknown[]) => unknown>>();

	on(name: string, callback: (...data: unknown[]) => unknown): EventRef {
		let set = this.listeners.get(name);
		if (!set) {
			set = new Set();
			this.listeners.set(name, set);
		}
		set.add(callback);
		return { eventName: name, callback };
	}

	off(name: string, callback: (...data: unknown[]) => unknown): void {
		this.listeners.get(name)?.delete(callback);
	}

	offref(ref: EventRef): void {
		this.off(ref.eventName, ref.callback);
	}

	trigger(name: string, ...data: unknown[]): void {
		const set = this.listeners.get(name);
		if (!set) return;
		for (const cb of Array.from(set)) {
			cb(...data);
		}
	}
}

export class TAbstractFile {
	vault!: Vault;
	path: string;
	name: string;
	parent: TFolder | null = null;

	constructor(path = '') {
		this.path = path;
		this.name = path.split('/').pop() ?? path;
	}
}

export class TFile extends TAbstractFile {
	stat: FileStats;
	basename: string;
	extension: string;

	constructor(path = '', mtime = 1000, size = 0) {
		super(path);
		const dotIdx = this.name.lastIndexOf('.');
		if (dotIdx > 0) {
			this.basename = this.name.slice(0, dotIdx);
			this.extension = this.name.slice(dotIdx + 1);
		} else {
			this.basename = this.name;
			this.extension = 'md';
		}
		this.stat = { ctime: mtime, mtime, size };
	}
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];

	constructor(path = '') {
		super(path);
	}

	isRoot(): boolean {
		return this.path === '' || this.path === '/';
	}
}

export interface VaultAdapterMock {
	exists: jest.Mock<Promise<boolean>, [string]>;
	read: jest.Mock<Promise<string>, [string]>;
	write: jest.Mock<Promise<void>, [string, string]>;
	remove: jest.Mock<Promise<void>, [string]>;
	list: jest.Mock<
		Promise<{ files: string[]; folders: string[] }>,
		[string]
	>;
	mkdir: jest.Mock<Promise<void>, [string]>;
}

export class Vault extends Events {
	configDir = '.obsidian';
	adapter: VaultAdapterMock = {
		exists: jest.fn<Promise<boolean>, [string]>(async () => false),
		read: jest.fn<Promise<string>, [string]>(async () => ''),
		write: jest.fn<Promise<void>, [string, string]>(async () => undefined),
		remove: jest.fn<Promise<void>, [string]>(async () => undefined),
		list: jest.fn<
			Promise<{ files: string[]; folders: string[] }>,
			[string]
		>(async () => ({ files: [], folders: [] })),
		mkdir: jest.fn<Promise<void>, [string]>(async () => undefined),
	};

	getAbstractFileByPath = jest.fn<TAbstractFile | null, [string]>(() => null);
	createFolder = jest.fn<Promise<TFolder>, [string]>(
		async (path: string) => new TFolder(path)
	);
	create = jest.fn<Promise<TFile>, [string, string]>(
		async (path: string, content: string) => new TFile(path, 1000, content.length)
	);
	read = jest.fn<Promise<string>, [TFile]>(async () => '');
	cachedRead = jest.fn<Promise<string>, [TFile]>(async (file: TFile) =>
		this.read(file)
	);
	modify = jest.fn<Promise<void>, [TFile, string]>(async () => undefined);
	delete = jest.fn<Promise<void>, [TAbstractFile, boolean?]>(async () => undefined);
	trash = jest.fn<Promise<void>, [TAbstractFile, boolean]>(async () => undefined);
	rename = jest.fn<Promise<void>, [TAbstractFile, string]>(async () => undefined);
	getMarkdownFiles = jest.fn<TFile[], []>(() => []);
	getFiles = jest.fn<TFile[], []>(() => []);
	getResourcePath = jest.fn<string, [TFile]>(
		(file: TFile) => `app://local/${file.path}`
	);
}

export class MetadataCache extends Events {
	getFileCache = jest.fn<CachedMetadata | null, [TFile]>(() => null);
	getFirstLinkpathDest = jest.fn<TFile | null, [string, string]>(() => null);
}

export class FileManager {
	processFrontMatter = jest.fn<
		Promise<void>,
		[TFile, (frontmatter: Record<string, unknown>) => void]
	>(async (_file, fn) => {
		fn({});
	});
	renameFile = jest.fn<Promise<void>, [TAbstractFile, string]>(
		async () => undefined
	);
}

export class SecretStorage extends Events {
	private store = new Map<string, string>();

	setSecret = jest.fn<void, [string, string]>((id: string, secret: string) => {
		this.store.set(id, secret);
	});
	getSecret = jest.fn<string | null, [string]>((id: string) => {
		return this.store.get(id) ?? null;
	});
	listSecrets = jest.fn<string[], []>(() => Array.from(this.store.keys()));
}

export class Scope {
	parent: Scope | null;
	handlers: Array<{
		modifiers: string[];
		key: string | null;
		func: (evt: KeyboardEvent, ctx?: unknown) => boolean | void;
	}> = [];

	constructor(parent?: Scope) {
		this.parent = parent ?? null;
	}

	register = jest.fn(
		(
			modifiers: string[],
			key: string | null,
			func: (evt: KeyboardEvent, ctx?: unknown) => boolean | void
		) => {
			const entry = { modifiers, key, func };
			this.handlers.push(entry);
			return entry;
		}
	);

	unregister = jest.fn();
}

export class WorkspaceLeaf {
	view: unknown = null;
	openFile = jest.fn<Promise<void>, [TFile]>(async () => undefined);
	setViewState = jest.fn<
		Promise<void>,
		[{ type: string; active?: boolean; state?: Record<string, unknown> }]
	>(async () => undefined);
}

export class Workspace extends Events {
	private defaultLeaf = new WorkspaceLeaf();

	getLeaf = jest.fn<WorkspaceLeaf, [boolean | string | undefined]>(
		() => this.defaultLeaf
	);
	getActiveFile = jest.fn<TFile | null, []>(() => null);
	openLinkText = jest.fn<Promise<void>, [string, string, boolean?]>(
		async () => undefined
	);
	getLeavesOfType = jest.fn<WorkspaceLeaf[], [string]>(() => []);
	openPopoutLeaf = jest.fn<WorkspaceLeaf, [unknown?]>(() => new WorkspaceLeaf());
	revealLeaf = jest.fn<Promise<void>, [WorkspaceLeaf]>(async () => undefined);
	onLayoutReady = jest.fn<void, [() => unknown]>((cb) => {
		cb();
	});
}

export class App {
	scope = new Scope();
	workspace = new Workspace();
	vault = new Vault();
	metadataCache = new MetadataCache();
	fileManager = new FileManager();
	secretStorage = new SecretStorage();
	plugins: {
		getPlugin: jest.Mock<unknown, [string]>;
	} = {
		getPlugin: jest.fn<unknown, [string]>(() => null),
	};
	commands: {
		commands: Record<string, Command>;
		executeCommandById: jest.Mock<boolean, [string]>;
	} = {
		commands: {},
		executeCommandById: jest.fn<boolean, [string]>(() => false),
	};
	setting?: {
		close?: jest.Mock<void, []>;
	};
}

export class Component {
	private loaded = false;
	private children: Component[] = [];
	private cleanups: Array<() => unknown> = [];
	private eventRefs: EventRef[] = [];

	load(): void {
		if (this.loaded) return;
		this.loaded = true;
		this.onload();
	}

	onload(): void {}

	unload(): void {
		if (!this.loaded) return;
		this.loaded = false;
		this.onunload();
		for (const child of this.children) {
			child.unload();
		}
		this.children = [];
		for (const cleanup of this.cleanups) {
			cleanup();
		}
		this.cleanups = [];
		this.eventRefs = [];
	}

	onunload(): void {}

	addChild<T extends Component>(component: T): T {
		this.children.push(component);
		if (this.loaded) component.load();
		return component;
	}

	removeChild<T extends Component>(component: T): T {
		this.children = this.children.filter((c) => c !== component);
		component.unload();
		return component;
	}

	register(cb: () => unknown): void {
		this.cleanups.push(cb);
	}

	registerEvent(eventRef: EventRef): void {
		this.eventRefs.push(eventRef);
	}

	registerDomEvent(
		el: EventTarget,
		type: string,
		callback: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions
	): void {
		el.addEventListener(type, callback, options);
		this.cleanups.push(() => el.removeEventListener(type, callback, options));
	}

	registerInterval(id: number): number {
		this.cleanups.push(() => clearInterval(id));
		return id;
	}
}

export class MarkdownRenderChild extends Component {
	containerEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		super();
		this.containerEl = containerEl;
	}
}

export class MarkdownRenderer {
	static render(
		_app: App,
		markdown: string,
		el: HTMLElement,
		_sourcePath: string,
		_component: Component
	): Promise<void> {
		installDomPolyfills();
		el.empty();
		const wikiRe = /\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|([^\]]+))?\]\]/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;
		let hasLinks = false;

		while ((match = wikiRe.exec(markdown)) !== null) {
			hasLinks = true;
			if (match.index > lastIndex) {
				el.appendChild(
					document.createTextNode(markdown.slice(lastIndex, match.index))
				);
			}
			const target = match[1].trim();
			const heading = match[2]?.trim();
			const alias = match[3]?.trim();
			const href = heading ? `${target}#${heading}` : target;
			const anchor = el.createEl('a', {
				cls: 'internal-link',
				text: alias || target,
				href,
				attr: { 'data-href': href },
			});
			void anchor;
			lastIndex = wikiRe.lastIndex;
		}

		if (!hasLinks) {
			el.textContent = markdown;
		} else if (lastIndex < markdown.length) {
			el.appendChild(document.createTextNode(markdown.slice(lastIndex)));
		}
		return Promise.resolve();
	}

	static renderMarkdown(
		markdown: string,
		el: HTMLElement,
		sourcePath: string,
		component: Component
	): Promise<void> {
		return MarkdownRenderer.render(new App(), markdown, el, sourcePath, component);
	}
}

const noticeMessages: string[] = [];

export class Notice {
	message: string;
	noticeEl: HTMLElement;

	constructor(message: string | DocumentFragment, _duration?: number) {
		installDomPolyfills();
		this.message =
			typeof message === 'string' ? message : (message.textContent ?? '');
		this.noticeEl = document.createElement('div');
		this.noticeEl.textContent = this.message;
		noticeMessages.push(this.message);
	}

	setMessage(message: string | DocumentFragment): this {
		this.message =
			typeof message === 'string' ? message : (message.textContent ?? '');
		this.noticeEl.textContent = this.message;
		return this;
	}

	hide(): void {
		this.noticeEl.remove();
	}
}

export function getNoticeMessages(): string[] {
	return [...noticeMessages];
}

export function clearNotices(): void {
	noticeMessages.length = 0;
}

const openedModals: Modal[] = [];

export class Modal {
	app: App;
	scope: Scope;
	containerEl: HTMLElement;
	modalEl: HTMLElement;
	titleEl: HTMLElement;
	contentEl: HTMLElement;
	shouldRestoreSelection = false;
	isOpen = false;

	constructor(app: App) {
		installDomPolyfills();
		this.app = app;
		this.scope = new Scope(app?.scope);
		this.containerEl = document.createElement('div');
		this.containerEl.addClass('modal-container');
		this.modalEl = this.containerEl.createDiv({ cls: 'modal' });
		this.titleEl = this.modalEl.createDiv({ cls: 'modal-title' });
		this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
	}

	open(): void {
		this.isOpen = true;
		openedModals.push(this);
		void this.onOpen();
	}

	close(): void {
		this.isOpen = false;
		this.onClose();
	}

	onOpen(): Promise<void> | void {}

	onClose(): void {}

	setTitle(title: string): this {
		this.titleEl.setText(title);
		return this;
	}
}

export function getOpenedModals(): Modal[] {
	return [...openedModals];
}

export function getLastOpenedModal<M = Modal>(): M | undefined {
	return openedModals[openedModals.length - 1] as unknown as M | undefined;
}

export function clearOpenedModals(): void {
	openedModals.length = 0;
}

export class SuggestModal<T> extends Modal {
	inputEl: HTMLInputElement;
	resultContainerEl: HTMLElement;
	emptyStateText = 'No match found.';
	limit = 100;

	constructor(app: App) {
		super(app);
		this.inputEl = this.modalEl.createEl('input', {
			cls: 'prompt-input',
			attr: { type: 'text' },
		});
		this.resultContainerEl = this.modalEl.createDiv({ cls: 'prompt-results' });
	}

	setPlaceholder(placeholder: string): void {
		this.inputEl.placeholder = placeholder;
	}

	setInstructions(
		_instructions: Array<{ command: string; purpose: string }>
	): void {}

	getSuggestions(_query: string): T[] | Promise<T[]> {
		return [];
	}

	renderSuggestion(_value: T, _el: HTMLElement): void {}

	onChooseSuggestion(_item: T, _evt: MouseEvent | KeyboardEvent): void {}

	selectSuggestion(value: T, evt: MouseEvent | KeyboardEvent): void {
		this.onChooseSuggestion(value, evt);
		this.close();
	}
}

export class FuzzySuggestModal<T> extends SuggestModal<FuzzyMatch<T>> {
	constructor(app: App) {
		super(app);
	}

	getItems(): T[] {
		return [];
	}

	getItemText(item: T): string {
		return String(item);
	}

	onChooseItem(_item: T, _evt: MouseEvent | KeyboardEvent): void {}

	override getSuggestions(query: string): FuzzyMatch<T>[] {
		const q = query.toLowerCase();
		return this.getItems()
			.filter((item) => this.getItemText(item).toLowerCase().includes(q))
			.map((item) => ({
				item,
				match: { score: 0, matches: [] },
			}));
	}

	override renderSuggestion(item: FuzzyMatch<T>, el: HTMLElement): void {
		el.setText(this.getItemText(item.item));
	}

	override onChooseSuggestion(
		item: FuzzyMatch<T>,
		evt: MouseEvent | KeyboardEvent
	): void {
		this.onChooseItem(item.item, evt);
	}
}

export class Plugin extends Component {
	app: App;
	manifest: PluginManifest;
	commands: Command[] = [];
	views = new Map<string, (leaf: WorkspaceLeaf) => ItemView>();
	codeBlockProcessors = new Map<
		string,
		(
			source: string,
			el: HTMLElement,
			ctx: MarkdownPostProcessorContext
		) => Promise<unknown> | void
	>();
	settingTabs: PluginSettingTab[] = [];
	ribbonIcons: Array<{ icon: string; title: string; el: HTMLElement }> = [];

	addCommand = jest.fn<Command, [Command]>((command: Command) => {
		this.commands.push(command);
		return command;
	});

	addSettingTab = jest.fn<void, [PluginSettingTab]>((tab: PluginSettingTab) => {
		this.settingTabs.push(tab);
	});

	registerView = jest.fn<void, [string, (leaf: WorkspaceLeaf) => ItemView]>(
		(type: string, viewCreator: (leaf: WorkspaceLeaf) => ItemView) => {
			this.views.set(type, viewCreator);
		}
	);

	registerMarkdownCodeBlockProcessor = jest.fn<
		void,
		[
			string,
			(
				source: string,
				el: HTMLElement,
				ctx: MarkdownPostProcessorContext
			) => Promise<unknown> | void,
		]
	>((language, handler) => {
		this.codeBlockProcessors.set(language, handler);
	});

	addRibbonIcon = jest.fn<
		HTMLElement,
		[string, string, (evt: MouseEvent) => unknown]
	>((icon: string, title: string, callback: (evt: MouseEvent) => unknown) => {
		installDomPolyfills();
		const el = document.createElement('div');
		el.setAttribute('aria-label', title);
		el.setAttribute('data-icon', icon);
		el.addEventListener('click', (evt) => {
			void callback(evt);
		});
		const entry = { icon, title, el };
		this.ribbonIcons.push(entry);
		const origRemove = el.remove.bind(el);
		el.remove = jest.fn(() => {
			this.ribbonIcons = this.ribbonIcons.filter((item) => item !== entry);
			origRemove();
		});
		return el;
	});

	loadData = jest.fn<Promise<unknown>, []>(async () => null);
	saveData = jest.fn<Promise<void>, [unknown]>(async () => undefined);

	constructor(app: App, manifest?: PluginManifest) {
		super();
		this.app = app;
		this.manifest = manifest ?? {
			id: 'zotero-annotation-reviewer',
			name: 'Zotero Annotation Reviewer',
			author: 'stone',
			version: '1.9.0',
			minAppVersion: '1.0.0',
			description: 'Test plugin manifest',
			dir: '.obsidian/plugins/zotero-annotation-reviewer',
		};
	}
}

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl: HTMLElement;

	constructor(app: App, plugin: Plugin) {
		installDomPolyfills();
		this.app = app;
		this.plugin = plugin;
		this.containerEl = document.createElement('div');
	}

	display(): void {}

	hide(): void {}
}

export class ButtonComponent {
	buttonEl: HTMLButtonElement;
	private disabled = false;

	constructor(containerEl: HTMLElement) {
		installDomPolyfills();
		this.buttonEl = containerEl.createEl('button', {
			attr: { type: 'button' },
		});
	}

	setButtonText(name: string): this {
		this.buttonEl.textContent = name;
		return this;
	}

	setIcon(icon: string): this {
		setIcon(this.buttonEl, icon);
		return this;
	}

	setTooltip(tooltip: string): this {
		this.buttonEl.setAttribute('title', tooltip);
		this.buttonEl.setAttribute('aria-label', tooltip);
		return this;
	}

	setCta(): this {
		this.buttonEl.addClass('mod-cta');
		return this;
	}

	removeCta(): this {
		this.buttonEl.removeClass('mod-cta');
		return this;
	}

	setWarning(): this {
		this.buttonEl.addClass('mod-warning');
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		this.buttonEl.disabled = disabled;
		return this;
	}

	setClass(cls: string): this {
		this.buttonEl.addClass(cls);
		return this;
	}

	onClick(callback: (evt: MouseEvent) => unknown): this {
		this.buttonEl.addEventListener('click', (evt) => {
			if (this.disabled) return;
			void callback(evt);
		});
		return this;
	}
}

export class ExtraButtonComponent {
	extraSettingsEl: HTMLElement;
	private disabled = false;

	constructor(containerEl: HTMLElement) {
		installDomPolyfills();
		this.extraSettingsEl = containerEl.createDiv({
			cls: 'clickable-icon extra-setting-button',
		});
	}

	setIcon(icon: string): this {
		setIcon(this.extraSettingsEl, icon);
		return this;
	}

	setTooltip(tooltip: string): this {
		this.extraSettingsEl.setAttribute('title', tooltip);
		this.extraSettingsEl.setAttribute('aria-label', tooltip);
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		this.extraSettingsEl.toggleClass('is-disabled', disabled);
		return this;
	}

	onClick(callback: () => unknown): this {
		this.extraSettingsEl.addEventListener('click', () => {
			if (this.disabled) return;
			void callback();
		});
		return this;
	}
}

export class TextComponent {
	inputEl: HTMLInputElement;

	constructor(containerEl: HTMLElement) {
		installDomPolyfills();
		this.inputEl = containerEl.createEl('input', {
			attr: { type: 'text' },
		});
	}

	getValue(): string {
		return this.inputEl.value;
	}

	setValue(value: string): this {
		this.inputEl.value = value;
		return this;
	}

	setPlaceholder(placeholder: string): this {
		this.inputEl.placeholder = placeholder;
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.inputEl.disabled = disabled;
		return this;
	}

	onChange(callback: (value: string) => unknown): this {
		this.inputEl.addEventListener('input', () => {
			void callback(this.inputEl.value);
		});
		return this;
	}
}

export class TextAreaComponent {
	inputEl: HTMLTextAreaElement;

	constructor(containerEl: HTMLElement) {
		installDomPolyfills();
		this.inputEl = containerEl.createEl('textarea');
	}

	getValue(): string {
		return this.inputEl.value;
	}

	setValue(value: string): this {
		this.inputEl.value = value;
		return this;
	}

	setPlaceholder(placeholder: string): this {
		this.inputEl.placeholder = placeholder;
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.inputEl.disabled = disabled;
		return this;
	}

	onChange(callback: (value: string) => unknown): this {
		this.inputEl.addEventListener('input', () => {
			void callback(this.inputEl.value);
		});
		return this;
	}
}

export class DropdownComponent {
	selectEl: HTMLSelectElement;

	constructor(containerEl: HTMLElement) {
		installDomPolyfills();
		this.selectEl = containerEl.createEl('select', { cls: 'dropdown' });
	}

	addOption(value: string, display: string): this {
		this.selectEl.createEl('option', { value, text: display });
		return this;
	}

	addOptions(options: Record<string, string>): this {
		for (const [val, display] of Object.entries(options)) {
			this.addOption(val, display);
		}
		return this;
	}

	getValue(): string {
		return this.selectEl.value;
	}

	setValue(value: string): this {
		this.selectEl.value = value;
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.selectEl.disabled = disabled;
		return this;
	}

	onChange(callback: (value: string) => unknown): this {
		this.selectEl.addEventListener('change', () => {
			void callback(this.selectEl.value);
		});
		return this;
	}
}

export class ToggleComponent {
	toggleEl: HTMLElement;
	checkboxEl: HTMLInputElement;
	private value = false;
	private disabled = false;

	constructor(containerEl: HTMLElement) {
		installDomPolyfills();
		this.toggleEl = containerEl.createDiv({ cls: 'checkbox-container' });
		this.checkboxEl = this.toggleEl.createEl('input', {
			attr: { type: 'checkbox' },
		});
	}

	getValue(): boolean {
		return this.value;
	}

	setValue(on: boolean): this {
		this.value = on;
		this.checkboxEl.checked = on;
		this.toggleEl.toggleClass('is-enabled', on);
		return this;
	}

	setTooltip(tooltip: string): this {
		this.toggleEl.setAttribute('title', tooltip);
		this.toggleEl.setAttribute('aria-label', tooltip);
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		this.checkboxEl.disabled = disabled;
		this.toggleEl.toggleClass('is-disabled', disabled);
		return this;
	}

	onChange(callback: (value: boolean) => unknown): this {
		this.checkboxEl.addEventListener('change', (ev) => {
			ev.stopPropagation();
			if (this.disabled) return;
			this.setValue(this.checkboxEl.checked);
			void callback(this.value);
		});
		this.toggleEl.addEventListener('click', (ev) => {
			if (ev.target === this.checkboxEl) return;
			if (this.disabled) return;
			this.setValue(!this.value);
			void callback(this.value);
		});
		return this;
	}
}

export class Setting {
	settingEl: HTMLElement;
	infoEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;
	components: unknown[] = [];

	constructor(containerEl: HTMLElement) {
		installDomPolyfills();
		this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
		this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
		this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
		this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
		this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
	}

	setName(name: string | DocumentFragment): this {
		this.nameEl.setText(name);
		return this;
	}

	setDesc(desc: string | DocumentFragment): this {
		this.descEl.setText(desc);
		return this;
	}

	setClass(cls: string): this {
		this.settingEl.addClass(cls);
		return this;
	}

	setTooltip(tooltip: string): this {
		this.nameEl.setAttribute('title', tooltip);
		return this;
	}

	setHeading(): this {
		this.settingEl.addClass('setting-item-heading');
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.settingEl.toggleClass('is-disabled', disabled);
		return this;
	}

	addButton(cb: (component: ButtonComponent) => unknown): this {
		const comp = new ButtonComponent(this.controlEl);
		this.components.push(comp);
		cb(comp);
		return this;
	}

	addExtraButton(cb: (component: ExtraButtonComponent) => unknown): this {
		const comp = new ExtraButtonComponent(this.controlEl);
		this.components.push(comp);
		cb(comp);
		return this;
	}

	addToggle(cb: (component: ToggleComponent) => unknown): this {
		const comp = new ToggleComponent(this.controlEl);
		this.components.push(comp);
		cb(comp);
		return this;
	}

	addText(cb: (component: TextComponent) => unknown): this {
		const comp = new TextComponent(this.controlEl);
		this.components.push(comp);
		cb(comp);
		return this;
	}

	addTextArea(cb: (component: TextAreaComponent) => unknown): this {
		const comp = new TextAreaComponent(this.controlEl);
		this.components.push(comp);
		cb(comp);
		return this;
	}

	addDropdown(cb: (component: DropdownComponent) => unknown): this {
		const comp = new DropdownComponent(this.controlEl);
		this.components.push(comp);
		cb(comp);
		return this;
	}
}

export class ItemView extends Component {
	app: App;
	leaf: WorkspaceLeaf;
	containerEl: HTMLElement;
	contentEl: HTMLElement;
	scope: Scope | null = null;

	constructor(leaf?: WorkspaceLeaf) {
		super();
		installDomPolyfills();
		this.leaf = leaf ?? new WorkspaceLeaf();
		this.app = new App();
		this.containerEl = document.createElement('div');
		this.containerEl.createDiv({ cls: 'view-header' });
		this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
	}

	getViewType(): string {
		return '';
	}

	getDisplayText(): string {
		return '';
	}

	getIcon(): string {
		return 'document';
	}

	async onOpen(): Promise<void> {}

	async onClose(): Promise<void> {}
}

export class MenuItem {
	title = '';
	icon = '';
	disabled = false;
	private clickHandler: ((evt: MouseEvent | KeyboardEvent) => unknown) | null = null;

	setTitle(title: string): this {
		this.title = title;
		return this;
	}

	setIcon(icon: string): this {
		this.icon = icon;
		return this;
	}

	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		return this;
	}

	onClick(callback: (evt: MouseEvent | KeyboardEvent) => unknown): this {
		this.clickHandler = callback;
		return this;
	}

	trigger(evt?: MouseEvent | KeyboardEvent): void {
		if (!this.disabled && this.clickHandler) {
			void this.clickHandler(evt ?? new MouseEvent('click'));
		}
	}
}

const openedMenus: Menu[] = [];

export class Menu {
	items: MenuItem[] = [];
	separators = 0;

	addItem(cb: (item: MenuItem) => unknown): this {
		const item = new MenuItem();
		this.items.push(item);
		cb(item);
		return this;
	}

	addSeparator(): this {
		this.separators += 1;
		return this;
	}

	showAtMouseEvent = jest.fn<this, [MouseEvent]>(() => {
		openedMenus.push(this);
		return this;
	});

	showAtPosition = jest.fn<this, [{ x: number; y: number }]>(() => {
		openedMenus.push(this);
		return this;
	});
}

export function getOpenedMenus(): Menu[] {
	return [...openedMenus];
}

export function clearOpenedMenus(): void {
	openedMenus.length = 0;
}

export const Platform = {
	isDesktopApp: false,
	isDesktop: false,
	isMobile: false,
	isMobileApp: false,
};

export const setIcon = jest.fn<void, [HTMLElement, string]>(
	(parent: HTMLElement, iconId: string) => {
		parent.setAttribute('data-icon', iconId);
	}
);

export const getIconIds = jest.fn<string[], []>(() => [
	'send',
	'webhook',
	'sparkles',
	'file-search',
	'globe',
	'search',
	'plus',
	'trash',
	'inbox',
]);

export const request = jest.fn<Promise<string>, [RequestUrlParam | string]>();

export const requestUrl = jest.fn<
	Promise<RequestUrlResponse>,
	[RequestUrlParam | string]
>();

export function resetObsidianMocks(): void {
	clearNotices();
	clearOpenedModals();
	clearOpenedMenus();
	Platform.isDesktopApp = false;
	Platform.isDesktop = false;
	Platform.isMobile = false;
	Platform.isMobileApp = false;
	request.mockReset();
	requestUrl.mockReset();
	setIcon.mockClear();
	getIconIds.mockClear();
}
