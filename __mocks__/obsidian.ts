import { jest } from '@jest/globals';

// Helper to create loose mocks that accept any arguments
// @ts-ignore
const mockFn = () => jest.fn<any, any[]>();

// 1. Helper to create DOM elements with Obsidian extensions
const createMockEl = (tag: string) => {
	const el = document.createElement(tag) as any;

	// Mock Obsidian's custom DOM methods
	el.createDiv = (o?: any) => {
		const div = createMockEl('div');
		if (typeof o === 'string') div.className = o;
		else if (o?.cls) div.className = o.cls;
		if (o?.text) div.textContent = o.text;
		el.appendChild(div);
		return div;
	};

	el.createSpan = (o?: any) => {
		const span = createMockEl('span');
		if (typeof o === 'string') span.className = o;
		else if (o?.cls) span.className = o.cls;
		if (o?.text) span.textContent = o.text;
		el.appendChild(span);
		return span;
	};

	el.createEl = (tag: string, o?: any) => {
		const child = createMockEl(tag);
		if (o?.cls) child.className = o.cls;
		if (o?.text) child.textContent = o.text;
		if (o?.attr) {
			Object.entries(o.attr).forEach(([k, v]) => child.setAttribute(k, v as string));
		}
		el.appendChild(child);
		return child;
	};

	el.setText = (text: string) => {
		el.textContent = text;
		return el;
	};

	el.empty = () => {
		el.innerHTML = '';
		return el;
	};

	el.addClass = (...classes: string[]) => {
		el.classList.add(...classes);
		return el;
	};

	return el;
};

// 2. Mock Classes using the helper
export class App {
	workspace: any;
	metadataCache: any;
	secretStorage: any;
	vault: any;

	constructor() {
		this.workspace = {
			getLeaf: mockFn().mockReturnValue({ openFile: mockFn() }),
			getActiveFile: mockFn(),
		};
		this.metadataCache = {
			getFileCache: mockFn(),
		};
		this.secretStorage = {
			listSecrets: mockFn().mockResolvedValue(['secret1', 'secret2']),
		};
		this.vault = {
			getAbstractFileByPath: mockFn(),
		};
	}
}

export class Plugin {
	app: App;
	settings: any;

	addCommand = mockFn();
	addSettingTab = mockFn();
	registerMarkdownCodeBlockProcessor = mockFn();
	loadData = mockFn();
	saveData = mockFn();

	constructor(app: App) {
		this.app = app;
	}
	async loadSettings() {}
	async saveSettings() {}
}

export class Notice {
	constructor(message: string) {}
}

export class Modal {
	app: App;
	contentEl: any;

	constructor(app: App) {
		this.app = app;
		this.contentEl = createMockEl('div');
	}
	open() { this.onOpen(); }
	close() { this.onClose(); }
	onOpen() {}
	onClose() {}
}

export class SuggestModal extends Modal {
	constructor(app: App) { super(app); }
	getSuggestions(query: string) { return []; }
	renderSuggestion(item: any, el: HTMLElement) {}
	onChooseSuggestion(item: any, evt: any) {}
}

export class PluginSettingTab {
	app: App;
	plugin: Plugin;
	containerEl: any;

	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = createMockEl('div');
	}
	display() {}
}

export class Setting {
	settingEl: any;
	nameEl: any;
	descEl: any;
	controlEl: any;

	constructor(containerEl: HTMLElement) {
		this.settingEl = createMockEl('div');
		this.controlEl = createMockEl('div');
		if (containerEl) containerEl.appendChild(this.settingEl);
		this.settingEl.appendChild(this.controlEl);
	}

	setName = mockFn().mockReturnThis();
	setDesc = mockFn().mockReturnThis();

	// Explicitly type 'cb' as any to fix TS2322/TS2345
	// @ts-ignore
	addText = jest.fn<any, any[]>((cb: any) => {
		const comp = {
			setValue: mockFn().mockReturnThis(),
			onChange: mockFn().mockReturnThis(),
			inputEl: createMockEl('input')
		};
		cb(comp);
		return this;
	}).mockReturnThis();

	// @ts-ignore
	addDropdown = jest.fn<any, any[]>((cb: any) => {
		const comp = {
			addOption: mockFn().mockReturnThis(),
			setValue: mockFn().mockReturnThis(),
			onChange: mockFn().mockReturnThis()
		};
		cb(comp);
		return this;
	}).mockReturnThis();

	// @ts-ignore
	addToggle = jest.fn<any, any[]>((cb: any) => {
		const comp = {
			setValue: mockFn().mockReturnThis(),
			onChange: mockFn().mockReturnThis()
		};
		cb(comp);
		return this;
	}).mockReturnThis();
}

export class ButtonComponent {
	// Explicitly type the internal storage as any
	_click: any = () => {};

	constructor(containerEl: HTMLElement) {}

	setButtonText = mockFn().mockReturnThis();
	setIcon = mockFn().mockReturnThis();
	setCta = mockFn().mockReturnThis();

	// Fix TS2322 by typing cb as any
	// @ts-ignore
	onClick = jest.fn<any, any[]>((cb: any) => {
		this._click = cb;
		return this;
	}).mockReturnThis();
}

export class TextAreaComponent {
	inputEl = createMockEl('textarea');
	constructor(containerEl: HTMLElement) {}
	setValue = mockFn().mockReturnThis();
	setPlaceholder = mockFn().mockReturnThis();
	onChange = mockFn().mockReturnThis();
}

export class TextComponent {
	inputEl = createMockEl('input');
	constructor(containerEl: HTMLElement) {}
	setPlaceholder = mockFn().mockReturnThis();
	setValue = mockFn().mockReturnThis();
	onChange = mockFn().mockReturnThis();
}

export class ToggleComponent {
	constructor(containerEl: HTMLElement) {}
	setValue = mockFn().mockReturnThis();
	onChange = mockFn().mockReturnThis();
}

export class DropdownComponent {
	selectEl = createMockEl('select');
	constructor(containerEl: HTMLElement) {}
	addOption = mockFn().mockReturnThis();
	setValue = mockFn().mockReturnThis();
	onChange = mockFn().mockReturnThis();
	setDisabled = mockFn().mockReturnThis();
}

export const setIcon = mockFn();
export class TFile {}
