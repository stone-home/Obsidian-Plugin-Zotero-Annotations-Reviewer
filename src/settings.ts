import {
	App,
	ButtonComponent,
	DropdownComponent,
	ExtraButtonComponent,
	FuzzyMatch,
	FuzzySuggestModal,
	getIconIds,
	Modal,
	Notice,
	PluginSettingTab,
	setIcon,
	Setting,
	TextComponent,
	TFile,
	ToggleComponent,
} from 'obsidian';
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	keymap,
	lineNumbers,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
	bracketMatching,
	defaultHighlightStyle,
	syntaxHighlighting,
} from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import ZoteroGKPlugin from './main';
import {
	DEFAULT_ASSISTANT_SCRIPT,
	DEFAULT_PAPER_WORKSPACE,
	DEFAULT_ZOTERO_TEMPLATE,
	PaperWorkspaceConfig,
	PromptTemplateEntry,
	WebhookInputVariable,
	WebhookProfile,
} from './types';
import { ZoteroService } from './services/zotero';
import { ZoteroConnectorService } from './services/zotero-connector';
import { normalizePath } from './utils/paths';

type SettingTabId = 'general' | 'zotero' | 'prompts' | 'webhook' | 'cfp' | 'digest';

function addSettingIconAction(
	parent: HTMLElement,
	icon: string,
	tooltip: string,
	onClick: () => void | Promise<void>
): HTMLElement {
	if (typeof ExtraButtonComponent === 'function') {
		const btn = new ExtraButtonComponent(parent)
			.setIcon(icon)
			.setTooltip(tooltip)
			.onClick(() => {
				void onClick();
			});
		return btn.extraSettingsEl;
	}
	const fallback = parent.createEl('button', {
		cls: 'clickable-icon extra-setting-button',
		attr: { 'aria-label': tooltip, title: tooltip, type: 'button' },
	});
	setIcon(fallback, icon);
	fallback.onclick = () => {
		void onClick();
	};
	return fallback;
}

// =========================================================================
// HELPER: Mount CodeMirror Editor
// =========================================================================
function mountCodeMirror(
	container: HTMLElement,
	initialValue: string,
	mode: 'javascript' | 'json' | 'markdown',
	onChange: (value: string) => void,
	options: { height?: string; placeholder?: string; wrap?: boolean } = {}
): EditorView {
	const extensions = [
		lineNumbers(),
		highlightActiveLine(),
		drawSelection(),
		history(),
		bracketMatching(),
		syntaxHighlighting(defaultHighlightStyle),
		keymap.of([...defaultKeymap, ...historyKeymap]),
		EditorView.updateListener.of((update) => {
			if (update.docChanged) {
				onChange(update.state.doc.toString());
			}
		}),
		oneDark,
	];

	if (mode === 'javascript') extensions.push(javascript());
	if (mode === 'json') extensions.push(json());
	if (options.wrap || mode === 'markdown') extensions.push(EditorView.lineWrapping);

	extensions.push(
		EditorView.theme({
			'&': {
				height: options.height || '300px',
				border: '1px solid var(--background-modifier-border)',
				borderRadius: '6px',
				fontSize: '13px',
			},
			'.cm-scroller': { overflow: 'auto' },
			'.cm-content': { fontFamily: 'var(--font-monospace)' },
		})
	);

	const startState = EditorState.create({
		doc: initialValue,
		extensions,
	});

	return new EditorView({
		state: startState,
		parent: container,
	});
}

class ConfirmActionModal extends Modal {
	constructor(
		app: App,
		private readonly titleText: string,
		private readonly messageText: string,
		private readonly confirmLabel: string,
		private readonly onConfirm: () => void | Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: this.titleText });
		contentEl.createEl('p', {
			text: this.messageText,
			cls: 'setting-item-description',
		});

		const footer = contentEl.createDiv({ cls: 'zotero-modal-footer' });
		const cancelBtn = footer.createEl('button', {
			text: 'Cancel',
			attr: { type: 'button' },
		});
		cancelBtn.onclick = () => this.close();

		const confirmBtn = footer.createEl('button', {
			cls: 'mod-warning',
			text: this.confirmLabel,
			attr: { type: 'button' },
		});
		confirmBtn.onclick = async () => {
			await this.onConfirm();
			this.close();
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function slugifyPromptId(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

class AddPromptModal extends Modal {
	private idTouched = false;

	constructor(
		app: App,
		private readonly existingIds: Set<string>,
		private readonly onSubmit: (result: { id: string; name: string }) => void | Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('zotero-webhook-input-modal');
		contentEl.createEl('h3', {
			text: 'Add Custom Prompt',
			cls: 'zotero-webhook-input-title',
		});

		const form = contentEl.createDiv({ cls: 'zotero-webhook-input-form' });
		const nameRow = form.createDiv({ cls: 'zotero-webhook-input-row' });
		nameRow.createEl('label', {
			text: 'Prompt name',
			cls: 'zotero-webhook-input-label',
		});
		const nameInput = nameRow.createEl('input', {
			cls: 'zotero-webhook-input-field',
			attr: {
				type: 'text',
				placeholder: 'e.g. Related Work Review',
			},
		}) as HTMLInputElement;

		const idRow = form.createDiv({ cls: 'zotero-webhook-input-row' });
		idRow.createEl('label', {
			text: 'Prompt ID ({{prompt.<id>}})',
			cls: 'zotero-webhook-input-label',
		});
		const idInput = idRow.createEl('input', {
			cls: 'zotero-webhook-input-field',
			attr: {
				type: 'text',
				placeholder: 'e.g. related_work_review',
			},
		}) as HTMLInputElement;

		nameInput.oninput = () => {
			if (!this.idTouched) {
				idInput.value = slugifyPromptId(nameInput.value);
			}
		};
		idInput.oninput = () => {
			this.idTouched = true;
		};

		const footer = contentEl.createDiv({ cls: 'zotero-webhook-input-footer' });
		const cancelBtn = footer.createEl('button', {
			text: 'Cancel',
			attr: { type: 'button' },
		});
		cancelBtn.onclick = () => this.close();

		const createBtn = footer.createEl('button', {
			cls: 'mod-cta',
			text: 'Create Prompt',
			attr: { type: 'button' },
		});
		createBtn.onclick = async () => {
			const cleanName = nameInput.value.trim();
			const cleanId = slugifyPromptId(idInput.value || cleanName);
			if (!cleanName || !cleanId) {
				new Notice('Please enter a valid prompt name and ID.');
				return;
			}
			if (this.existingIds.has(cleanId)) {
				new Notice(`Prompt ID "${cleanId}" already exists.`);
				return;
			}
			await this.onSubmit({ id: cleanId, name: cleanName });
			this.close();
		};
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// =========================================================================
// MAIN SETTING TAB
// =========================================================================
export class ZoteroSettingTab extends PluginSettingTab {
	plugin: ZoteroGKPlugin;
	activeTab: SettingTabId = 'general';

	constructor(app: App, plugin: ZoteroGKPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('zotero-settings-wrapper');

		// --- 1. Tab Navigation (Single-Row 6 Equal Columns) ---
		const tabsEl = containerEl.createDiv({ cls: 'zotero-settings-tabs' });

		this.renderTabItem(tabsEl, 'general', 'General');
		this.renderTabItem(tabsEl, 'zotero', 'Highlights');
		this.renderTabItem(tabsEl, 'prompts', 'Templates');
		this.renderTabItem(tabsEl, 'webhook', 'Webhooks');
		this.renderTabItem(tabsEl, 'cfp', 'CFP');
		this.renderTabItem(tabsEl, 'digest', 'Digest');

		// --- 2. Tab Content ---
		const bodyEl = containerEl.createDiv({ cls: 'zotero-setting-container' });

		if (this.activeTab === 'general') this.renderGeneralSettings(bodyEl);
		else if (this.activeTab === 'zotero') this.renderZoteroSettings(bodyEl);
		else if (this.activeTab === 'prompts') this.renderPromptsSettings(bodyEl);
		else if (this.activeTab === 'webhook') this.renderWebhookSettings(bodyEl);
		else if (this.activeTab === 'cfp') this.renderCFPSettings(bodyEl);
		else if (this.activeTab === 'digest') {
			import('./ui/digest-settings')
				.then((digest) =>
					digest.renderDigestSettings(bodyEl, this.plugin, () => this.display())
				)
				.catch((e) => console.error('[Paper Digest] settings failed', e));
		}
	}

	renderTabItem(container: HTMLElement, id: SettingTabId, label: string): void {
		const tab = container.createDiv({
			cls: `zotero-tab-item ${this.activeTab === id ? 'active' : ''}`,
		});
		tab.innerText = label;
		tab.onclick = () => {
			this.activeTab = id;
			this.display();
		};
	}

	// -------------------------------------------------------------------------
	// TAB 1: GENERAL
	// -------------------------------------------------------------------------
	renderGeneralSettings(container: HTMLElement): void {
		const ws = this.plugin.settings.paperWorkspace;

		// === CARD 1: PAPER WORKSPACE LAYOUT ===
		const layoutCard = container.createDiv({ cls: 'zotero-setting-card' });
		layoutCard.createEl('h3', {
			text: 'Paper Workspace Layout',
			cls: 'zotero-card-title',
		});
		layoutCard.createDiv({
			text: 'Configure button labels and Vault-relative path patterns for each paper resource. Use {{citekey}} for automatic citation-key substitution.',
			cls: 'setting-item-description zotero-desc-tight',
		});

		const syncRefs: {
			highlightNotes: TextComponent | null;
			fleetingFolder: TextComponent | null;
		} = {
			highlightNotes: null,
			fleetingFolder: null,
		};

		const addPathRow = (
			name: string,
			desc: string,
			key: keyof PaperWorkspaceConfig,
			defaultVal: string,
			options?: {
				labelKey?: keyof PaperWorkspaceConfig;
				defaultLabel?: string;
				afterSave?: (val: string) => void;
				onInitRef?: (ref: TextComponent) => void;
			}
		): void => {
			const labelRef: { current: TextComponent | null } = { current: null };
			const rowRef: { current: TextComponent | null } = { current: null };
			const setting = new Setting(layoutCard).setName(name).setDesc(desc);

			if (options?.labelKey && options.defaultLabel) {
				const lKey = options.labelKey;
				const defLabel = options.defaultLabel;
				setting.addText((labelInput) => {
					labelRef.current = labelInput;
					labelInput.setPlaceholder?.(defLabel);
					labelInput.setValue(ws[lKey] || defLabel).onChange(async (val) => {
						ws[lKey] = val.trim() || defLabel;
						await this.plugin.saveSettings();
					});
					labelInput.inputEl.addClass('zotero-workspace-label-input');
					labelInput.inputEl.setAttribute('aria-label', `${name} button label`);
					labelInput.inputEl.setAttribute('title', 'Button label');
				});
			}

			setting.addText((text) => {
				rowRef.current = text;
				if (options?.onInitRef) options.onInitRef(text);
				text.setPlaceholder?.(defaultVal);
				text.setValue(ws[key]).onChange(async (val) => {
					ws[key] = val.trim();
					if (options?.afterSave) options.afterSave(ws[key]);
					await this.plugin.saveSettings();
				});
				text.inputEl.addClass('zotero-workspace-path-input');
			});

			const resetTooltip =
				options?.labelKey && options.defaultLabel
					? `Reset to default (${options.defaultLabel} · ${defaultVal})`
					: `Reset to default (${defaultVal})`;

			addSettingIconAction(setting.controlEl, 'rotate-ccw', resetTooltip, async () => {
				if (options?.labelKey && options.defaultLabel) {
					ws[options.labelKey] = options.defaultLabel;
					labelRef.current?.setValue(options.defaultLabel);
				}
				ws[key] = defaultVal;
				if (options?.afterSave) options.afterSave(defaultVal);
				rowRef.current?.setValue(defaultVal);
				await this.plugin.saveSettings();
			});
		};

		addPathRow(
			'Zotero Note',
			'Primary literature note imported from Zotero.',
			'literatureNotePath',
			DEFAULT_PAPER_WORKSPACE.literatureNotePath
		);
		addPathRow(
			'Takeaway',
			'Button label and Vault path pattern for synthesized takeaway notes.',
			'takeawayPath',
			DEFAULT_PAPER_WORKSPACE.takeawayPath,
			{
				labelKey: 'takeawayLabel',
				defaultLabel: DEFAULT_PAPER_WORKSPACE.takeawayLabel,
			}
		);
		addPathRow(
			'Report 1',
			'Button label and Vault path pattern for internal deep-research reports.',
			'report1Path',
			DEFAULT_PAPER_WORKSPACE.report1Path,
			{
				labelKey: 'report1Label',
				defaultLabel: DEFAULT_PAPER_WORKSPACE.report1Label,
			}
		);
		addPathRow(
			'Report 2',
			'Button label and Vault path pattern for external landscape & code discovery reports.',
			'report2Path',
			DEFAULT_PAPER_WORKSPACE.report2Path,
			{
				labelKey: 'report2Label',
				defaultLabel: DEFAULT_PAPER_WORKSPACE.report2Label,
			}
		);
		addPathRow(
			'Core Note',
			'Personal core claim, projects, and linked atomic notes.',
			'coreNotePath',
			DEFAULT_PAPER_WORKSPACE.coreNotePath
		);
		addPathRow(
			'Highlight Notes (Fleeting)',
			'Folder where exported PDF highlight / fleeting notes are saved.',
			'highlightNotesFolder',
			DEFAULT_PAPER_WORKSPACE.highlightNotesFolder,
			{
				afterSave: (val) => {
					this.plugin.settings.fleetingNoteFolder = val;
					syncRefs.fleetingFolder?.setValue(val);
				},
				onInitRef: (ref) => {
					syncRefs.highlightNotes = ref;
				},
			}
		);
		addPathRow(
			'Atomic Notes Folder',
			'Folder where permanent Atomic Zettels (A - L1 - L2 - L3) live.',
			'atomicNotesFolder',
			DEFAULT_PAPER_WORKSPACE.atomicNotesFolder
		);

		// === CARD 2: ZOTERO CONNECTION & KEYS ===
		const zoteroConnCard = container.createDiv({ cls: 'zotero-setting-card' });
		zoteroConnCard.createEl('h3', {
			text: 'Zotero Connection & Keys',
			cls: 'zotero-card-title',
		});

		new Setting(zoteroConnCard)
			.setName('Zotero Port')
			.setDesc('Port for Better BibTeX JSON-RPC (Default: 23119)')
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.zoteroPort))
					.onChange(async (value) => {
						const port = Number(value) || 23119;
						this.plugin.settings.zoteroPort = port;
						this.plugin.zotero = new ZoteroService(port);
						await this.plugin.saveSettings();
					})
			);

		new Setting(zoteroConnCard)
			.setName('Fleeting Notes Folder')
			.setDesc(
				'Folder where exported highlight / fleeting notes are stored (synced with Highlight Notes in Paper Workspace Layout).'
			)
			.addText((text) => {
				syncRefs.fleetingFolder = text;
				text.setPlaceholder?.(DEFAULT_PAPER_WORKSPACE.highlightNotesFolder);
				text.setValue(
					this.plugin.settings.fleetingNoteFolder || ws.highlightNotesFolder
				).onChange(async (value) => {
					const trimmed = value.trim();
					this.plugin.settings.fleetingNoteFolder = trimmed;
					ws.highlightNotesFolder = trimmed;
					syncRefs.highlightNotes?.setValue(trimmed);
					await this.plugin.saveSettings();
				});
			});

		new Setting(zoteroConnCard)
			.setName('Citation Key Name')
			.setDesc(
				'Frontmatter key storing the Better BibTeX citation key (e.g. "citation-key").'
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.citationKeyName)
					.onChange(async (value) => {
						this.plugin.settings.citationKeyName = value.trim() || 'citation-key';
						await this.plugin.saveSettings();
					})
			);

		new Setting(zoteroConnCard)
			.setName('Annotation Key Name')
			.setDesc(
				'Frontmatter key identifying an exported Zotero annotation (e.g. "annotation-id").'
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.annotationKeyName)
					.onChange(async (value) => {
						this.plugin.settings.annotationKeyName =
							value.trim() || 'annotation-id';
						await this.plugin.saveSettings();
					})
			);

		// === CARD 4: PROJECT LINKER ===
		const projectCard = container.createDiv({ cls: 'zotero-setting-card' });
		projectCard.createEl('h3', { text: 'Project Linker', cls: 'zotero-card-title' });

		new Setting(projectCard)
			.setName('Projects Folder')
			.setDesc('Folder containing your project notes.')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.projectsFolder)
					.onChange(async (value) => {
						this.plugin.settings.projectsFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(projectCard)
			.setName('Project Frontmatter Key')
			.setDesc('YAML key updated when linking a project (e.g. "projects").')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.projectFrontmatterKey)
					.onChange(async (value) => {
						this.plugin.settings.projectFrontmatterKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(projectCard)
			.setName('Project ID Key')
			.setDesc(
				'Frontmatter key on project notes used as link alias (e.g. "project_id").'
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.projectIdKey)
					.onChange(async (value) => {
						this.plugin.settings.projectIdKey = value;
						await this.plugin.saveSettings();
					})
			);
	}

	// -------------------------------------------------------------------------
	// TAB 2: ZOTERO & HIGHLIGHTS
	// -------------------------------------------------------------------------
	renderZoteroSettings(container: HTMLElement): void {
		const sortCard = container.createDiv({ cls: 'zotero-setting-card' });
		sortCard.createEl('h3', {
			text: 'Highlight Review Preferences',
			cls: 'zotero-card-title',
		});

		new Setting(sortCard)
			.setName('Default Annotation Sort')
			.setDesc('Property to sort highlights by in the review modal.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('color', 'Color (Group by Color)')
					.addOption('pageLabel', 'Page Number')
					.addOption('type', 'Annotation Type')
					.addOption('text', 'Content Text')
					.setValue(this.plugin.settings.sortProperty)
					.onChange(async (value) => {
						this.plugin.settings.sortProperty = value;
						await this.plugin.saveSettings();
					})
			);

		const metaCard = container.createDiv({ cls: 'zotero-setting-card' });
		metaCard.createEl('h3', {
			text: 'Metadata Verification',
			cls: 'zotero-card-title',
		});
		const metaList = metaCard.createDiv({ cls: 'zotero-settings-list' });

		this.plugin.settings.metadataMapping.forEach((item, index) => {
			const block = metaList.createDiv({ cls: 'zotero-setting-block' });
			new ToggleComponent(block).setValue(item.enabled).onChange(async (v) => {
				item.enabled = v;
				await this.plugin.saveSettings();
			});
			new TextComponent(block)
				.setPlaceholder('Label')
				.setValue(item.label)
				.onChange(async (v) => {
					item.label = v;
					await this.plugin.saveSettings();
				});
			new TextComponent(block)
				.setPlaceholder('Zotero')
				.setValue(item.zoteroProp)
				.onChange(async (v) => {
					item.zoteroProp = v;
					await this.plugin.saveSettings();
				});
			block.createSpan({ text: '➔' });
			new TextComponent(block)
				.setPlaceholder('Note YAML')
				.setValue(item.noteProp)
				.onChange(async (v) => {
					item.noteProp = v;
					await this.plugin.saveSettings();
				});

			new ButtonComponent(block).setIcon('trash').onClick(async () => {
				this.plugin.settings.metadataMapping.splice(index, 1);
				await this.plugin.saveSettings();
				this.display();
			});
		});

		new ButtonComponent(metaCard.createDiv({ cls: 'zotero-setting-center-btn' }))
			.setButtonText('+ Add Property')
			.onClick(async () => {
				this.plugin.settings.metadataMapping.push({
					label: 'New',
					zoteroProp: '',
					noteProp: '',
					enabled: true,
				});
				await this.plugin.saveSettings();
				this.display();
			});

		// Assistant Custom JS (Open by default)
		const customJsCard = container.createDiv({ cls: 'zotero-setting-card' });
		customJsCard.createEl('h3', {
			text: 'Assistant Custom JS',
			cls: 'zotero-card-title',
		});

		new Setting(customJsCard)
			.setName('Enable legacy DataviewJS section in Assistant')
			.setDesc(
				'Render the custom DataviewJS snippet inside zotero-assistant blocks. Disabled by default in favor of native inline highlights.'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(Boolean(this.plugin.settings.enableLegacyAssistantScript))
					.onChange(async (val) => {
						this.plugin.settings.enableLegacyAssistantScript = val;
						await this.plugin.saveSettings();
					})
			);

		const scriptHeaderRow = customJsCard.createDiv({ cls: 'zotero-legacy-script-bar' });
		scriptHeaderRow.createSpan({
			text: 'Available params: dv, input',
			cls: 'setting-item-description',
		});
		new ButtonComponent(scriptHeaderRow)
			.setButtonText('Reset Script')
			.onClick(async () => {
				this.plugin.settings.assistantScript = DEFAULT_ASSISTANT_SCRIPT;
				await this.plugin.saveSettings();
				this.display();
			});

		const scriptWrapper = customJsCard.createDiv();
		mountCodeMirror(
			scriptWrapper,
			this.plugin.settings.assistantScript,
			'javascript',
			async (val) => {
				this.plugin.settings.assistantScript = val;
				await this.plugin.saveSettings();
			},
			{ height: '240px' }
		);
	}

	// -------------------------------------------------------------------------
	// TAB 3: TEMPLATES & PROMPTS (FILE-BASED MANAGEMENT)
	// -------------------------------------------------------------------------
	private async openVaultMarkdownInEditor(
		rawPath: string,
		fallbackContent: string
	): Promise<string> {
		const trimmed = rawPath.trim();
		const normalized = normalizePath(
			/\.[^/\\]+$/.test(trimmed) ? trimmed : `${trimmed}.md`
		);
		await this.plugin.paperHub.ensureParentFolder(normalized);
		const existing = this.app.vault.getAbstractFileByPath(normalized);
		let fileToOpen: TFile;
		if (existing instanceof TFile) {
			fileToOpen = existing;
		} else if (typeof this.app.vault.create === 'function') {
			fileToOpen = await this.app.vault.create(normalized, fallbackContent);
		} else {
			new Notice(`File not found in Vault: ${normalized}`);
			return normalized;
		}
		await this.app.workspace.getLeaf(false).openFile(fileToOpen);
		(this.app as unknown as { setting?: { close?: () => void } }).setting?.close?.();
		return normalized;
	}

	renderPromptsSettings(container: HTMLElement): void {
		const ws = this.plugin.settings.paperWorkspace;
		const connector = new ZoteroConnectorService(this.app, this.plugin.settings);
		const tplConfig = this.plugin.settings.zoteroTemplate;
		const currentFolder = normalizePath(
			ws.templatesFolder?.trim() || DEFAULT_PAPER_WORKSPACE.templatesFolder
		).replace(/\/+$/, '');
		let draftFolder = currentFolder;

		const addActionBtn = (
			parent: HTMLElement,
			label: string,
			onClick: () => void | Promise<void>,
			isCta = false
		): HTMLButtonElement => {
			const btn = parent.createEl('button', {
				cls: isCta ? 'mod-cta' : undefined,
				text: label,
				attr: { type: 'button' },
			}) as HTMLButtonElement;
			btn.onclick = () => {
				void onClick();
			};
			return btn;
		};

		// === CARD 1: TEMPLATES & PROMPTS FOLDER ===
		const folderCard = container.createDiv({ cls: 'zotero-setting-card' });
		folderCard.createEl('h3', {
			text: 'Templates & Prompts Folder',
			cls: 'zotero-card-title',
		});
		folderCard.createDiv({
			text: 'Unified Vault folder where customizable note templates and prompts live as standard Markdown files.',
			cls: 'setting-item-description zotero-desc-tight',
		});

		const folderRow = folderCard.createDiv({ cls: 'zotero-template-folder-row' });
		const folderInput = folderRow.createEl('input', {
			cls: 'zotero-workspace-path-input zotero-flex-1',
			attr: {
				type: 'text',
				placeholder: DEFAULT_PAPER_WORKSPACE.templatesFolder,
			},
		}) as HTMLInputElement;
		folderInput.value = currentFolder;
		folderInput.oninput = () => {
			draftFolder = folderInput.value.trim();
		};

		addActionBtn(
			folderRow,
			'Move Folder',
			async () => {
				const rawVal = folderInput.value.trim() || draftFolder;
				const nextFolder = normalizePath(
					rawVal || DEFAULT_PAPER_WORKSPACE.templatesFolder
				).replace(/\/+$/, '');
				if (!nextFolder) {
					new Notice('Please enter a valid Vault folder path.');
					return;
				}
				const oldFolder = normalizePath(
					ws.templatesFolder?.trim() || DEFAULT_PAPER_WORKSPACE.templatesFolder
				).replace(/\/+$/, '');
				const moved = await this.plugin.paperHub.moveTemplatesFolder(
					oldFolder,
					nextFolder
				);
				ws.templatesFolder = nextFolder;
				await this.plugin.saveSettings();
				new Notice(
					moved > 0
						? `Moved ${moved} template/prompt file${moved === 1 ? '' : 's'} to ${nextFolder}.`
						: `Templates folder set to ${nextFolder}.`
				);
				this.display();
			},
			true
		);

		addActionBtn(folderRow, 'Sync Missing Defaults', async () => {
			const created = await this.plugin.paperHub.ensureBuiltinTemplatesInVault();
			await this.plugin.saveSettings();
			new Notice(
				created > 0
					? `Created ${created} missing default file${created === 1 ? '' : 's'} in Vault.`
					: 'All built-in templates and prompts already exist in Vault.'
			);
			this.display();
		});

		// === CARD 2: NOTE TEMPLATES ===
		const templatesCard = container.createDiv({ cls: 'zotero-setting-card' });
		templatesCard.createEl('h3', {
			text: 'Note Templates',
			cls: 'zotero-card-title',
		});
		templatesCard.createDiv({
			text: 'Standard YAML frontmatter and note templates materialized in your Vault. Click Open to edit directly in Obsidian.',
			cls: 'setting-item-description zotero-desc-tight',
		});

		const tplList = templatesCard.createDiv({ cls: 'zotero-template-file-list' });

		// 2a. Zotero Note Template row
		const zotDefaultPath = currentFolder
			? `${currentFolder}/zotero-note-template.md`
			: 'zotero-note-template.md';
		const resolvedZotPath = normalizePath(tplConfig.vaultPath?.trim() || zotDefaultPath);
		const zotRow = tplList.createDiv({ cls: 'zotero-template-file-row' });
		const zotInfo = zotRow.createDiv({ cls: 'zotero-template-file-info' });
		zotInfo.createDiv({
			cls: 'zotero-template-file-name',
			text: 'Zotero Note Template',
		});
		zotInfo.createDiv({
			cls: 'zotero-template-file-path',
			text: resolvedZotPath,
		});

		const zotActions = zotRow.createDiv({ cls: 'zotero-template-file-actions' });
		addActionBtn(zotActions, 'Detect', async () => {
			const detected = connector.detectTemplatePath();
			if (!detected) {
				new Notice(
					'Could not auto-detect template path from Zotero Integration.'
				);
				return;
			}
			tplConfig.vaultPath = detected;
			await this.plugin.saveSettings();
			new Notice(`Detected Zotero template: ${detected}`);
			this.display();
		});

		addActionBtn(
			zotActions,
			'Open',
			async () => {
				const openedPath = await this.openVaultMarkdownInEditor(
					resolvedZotPath,
					tplConfig.content || DEFAULT_ZOTERO_TEMPLATE
				);
				if (!tplConfig.vaultPath?.trim()) {
					tplConfig.vaultPath = openedPath;
					await this.plugin.saveSettings();
				}
			},
			true
		);

		addActionBtn(zotActions, 'Snapshot', async () => {
			const loaded = await connector.loadTemplateContent(resolvedZotPath);
			tplConfig.content = loaded.content;
			tplConfig.snapshot = loaded.content;
			await this.plugin.saveSettings();
			new Notice('Saved snapshot for Zotero Note Template.');
			this.display();
		});

		if (tplConfig.snapshot) {
			addActionBtn(zotActions, 'Restore', () => {
				new ConfirmActionModal(
					this.app,
					'Restore Zotero Note Template Snapshot?',
					`Overwrite ${resolvedZotPath} with your saved snapshot?`,
					'Restore',
					async () => {
						const snap = tplConfig.snapshot || DEFAULT_ZOTERO_TEMPLATE;
						const savedPath = await connector.saveTemplateToVault(
							resolvedZotPath,
							snap
						);
						tplConfig.vaultPath = savedPath;
						tplConfig.content = snap;
						await this.plugin.saveSettings();
						new Notice('Restored Zotero Note Template snapshot.');
						this.display();
					}
				).open();
			});
		}

		addActionBtn(zotActions, 'Reset', () => {
			new ConfirmActionModal(
				this.app,
				'Reset Zotero Note Template?',
				`Reset ${resolvedZotPath} to the factory default Nunjucks template?`,
				'Reset',
				async () => {
					const savedPath = await connector.saveTemplateToVault(
						resolvedZotPath,
						DEFAULT_ZOTERO_TEMPLATE
					);
					tplConfig.vaultPath = savedPath;
					tplConfig.content = DEFAULT_ZOTERO_TEMPLATE;
					await this.plugin.saveSettings();
					new Notice('Reset Zotero Note Template to default.');
					this.display();
				}
			).open();
		});

		// 2b. Built-in Note Frontmatter Templates (kind === 'template')
		const noteTemplates = this.plugin.settings.prompts.filter(
			(entry) => entry.kind === 'template'
		);
		for (const entry of noteTemplates) {
			const fallbackPath = `${currentFolder}/${entry.id.replace(/^tpl-/, '')}-note-template.md`;
			const entryPath = normalizePath(entry.vaultPath?.trim() || fallbackPath);
			const row = tplList.createDiv({ cls: 'zotero-template-file-row' });
			const info = row.createDiv({ cls: 'zotero-template-file-info' });
			info.createDiv({ cls: 'zotero-template-file-name', text: entry.name });
			info.createDiv({ cls: 'zotero-template-file-path', text: entryPath });

			const actions = row.createDiv({ cls: 'zotero-template-file-actions' });
			addActionBtn(
				actions,
				'Open',
				async () => {
					const openedPath = await this.openVaultMarkdownInEditor(
						entryPath,
						entry.content
					);
					if (entry.vaultPath !== openedPath) {
						entry.vaultPath = openedPath;
						await this.plugin.saveSettings();
					}
				},
				true
			);

			addActionBtn(actions, 'Snapshot', async () => {
				const live = await this.plugin.paperHub.getPromptContent(entry.id);
				entry.content = live;
				entry.snapshot = live;
				await this.plugin.saveSettings();
				new Notice(`Saved snapshot for ${entry.name}.`);
				this.display();
			});

			if (entry.snapshot) {
				addActionBtn(actions, 'Restore', () => {
					new ConfirmActionModal(
						this.app,
						`Restore "${entry.name}" Snapshot?`,
						`Overwrite ${entryPath} with your saved snapshot?`,
						'Restore',
						async () => {
							const snap = entry.snapshot || entry.content;
							entry.vaultPath = entryPath;
							const savedPath = await this.plugin.paperHub.savePromptToVault(
								entry,
								snap
							);
							entry.vaultPath = savedPath;
							entry.content = snap;
							await this.plugin.saveSettings();
							new Notice(`Restored snapshot for ${entry.name}.`);
							this.display();
						}
					).open();
				});
			}

			addActionBtn(actions, 'Reset', () => {
				const builtInDefault = this.plugin.paperHub.getBuiltInDefaultContent(entry.id);
				if (!builtInDefault) return;
				new ConfirmActionModal(
					this.app,
					`Reset "${entry.name}"?`,
					`Reset ${entryPath} to the factory default template?`,
					'Reset',
					async () => {
						entry.vaultPath = entryPath;
						const savedPath = await this.plugin.paperHub.savePromptToVault(
							entry,
							builtInDefault
						);
						entry.vaultPath = savedPath;
						entry.content = builtInDefault;
						await this.plugin.saveSettings();
						new Notice(`Reset ${entry.name} to default.`);
						this.display();
					}
				).open();
			});
		}

		// === CARD 3: PROMPTS ===
		const promptsCard = container.createDiv({ cls: 'zotero-setting-card' });
		const promptsHeader = promptsCard.createDiv({
			cls: 'zotero-template-card-header',
		});
		promptsHeader.createEl('h3', {
			text: 'Prompts',
			cls: 'zotero-card-title zotero-no-margin',
		});
		addActionBtn(
			promptsHeader,
			'+ Add Prompt',
			() => {
				const existingIds = new Set(
					this.plugin.settings.prompts.map((p) => p.id)
				);
				new AddPromptModal(this.app, existingIds, async ({ id, name }) => {
					const targetPath = normalizePath(
						`${currentFolder}/prompt-${id}.md`
					);
					const initialContent = `# ${name}\n\nWrite your prompt instructions here.\n`;
					const newEntry: PromptTemplateEntry = {
						id,
						name,
						kind: 'prompt',
						vaultPath: targetPath,
						content: initialContent,
						builtIn: false,
					};
					if (typeof this.app.vault.create === 'function') {
						newEntry.vaultPath =
							await this.plugin.paperHub.savePromptToVault(
								newEntry,
								initialContent
							);
					}
					this.plugin.settings.prompts.push(newEntry);
					await this.plugin.saveSettings();
					new Notice(`Created prompt "${name}".`);
					this.display();
				}).open();
			},
			true
		);

		promptsCard.createDiv({
			text: 'LLM synthesis and research prompts. Click a {{prompt.<id>}} chip to copy its webhook placeholder.',
			cls: 'setting-item-description zotero-desc-tight',
		});

		const promptList = promptsCard.createDiv({ cls: 'zotero-template-file-list' });
		const promptEntries = this.plugin.settings.prompts.filter(
			(entry) => (entry.kind ?? 'prompt') === 'prompt'
		);

		for (const entry of promptEntries) {
			const fallbackPath = `${currentFolder}/prompt-${entry.id}.md`;
			const entryPath = normalizePath(entry.vaultPath?.trim() || fallbackPath);
			const row = promptList.createDiv({ cls: 'zotero-template-file-row' });
			const info = row.createDiv({ cls: 'zotero-template-file-info' });

			const titleLine = info.createDiv({ cls: 'zotero-template-file-title-line' });
			titleLine.createSpan({ cls: 'zotero-template-file-name', text: entry.name });
			const placeholderToken = `{{prompt.${entry.id}}}`;
			const chip = titleLine.createEl('button', {
				cls: 'zotero-placeholder-chip',
				text: placeholderToken,
				attr: { type: 'button', title: 'Click to copy placeholder' },
			});
			chip.onclick = async () => {
				if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(placeholderToken);
					new Notice(`Copied ${placeholderToken}`);
				}
			};

			info.createDiv({ cls: 'zotero-template-file-path', text: entryPath });

			const actions = row.createDiv({ cls: 'zotero-template-file-actions' });
			addActionBtn(
				actions,
				'Open',
				async () => {
					const openedPath = await this.openVaultMarkdownInEditor(
						entryPath,
						entry.content
					);
					if (entry.vaultPath !== openedPath) {
						entry.vaultPath = openedPath;
						await this.plugin.saveSettings();
					}
				},
				true
			);

			addActionBtn(actions, 'Copy', async () => {
				const live = await this.plugin.paperHub.getPromptContent(entry.id);
				if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(live);
					new Notice(`Copied "${entry.name}" prompt to clipboard.`);
				}
			});

			addActionBtn(actions, 'Snapshot', async () => {
				const live = await this.plugin.paperHub.getPromptContent(entry.id);
				entry.content = live;
				entry.snapshot = live;
				await this.plugin.saveSettings();
				new Notice(`Saved snapshot for ${entry.name}.`);
				this.display();
			});

			if (entry.snapshot) {
				addActionBtn(actions, 'Restore', () => {
					new ConfirmActionModal(
						this.app,
						`Restore "${entry.name}" Snapshot?`,
						`Overwrite ${entryPath} with your saved snapshot?`,
						'Restore',
						async () => {
							const snap = entry.snapshot || entry.content;
							entry.vaultPath = entryPath;
							const savedPath = await this.plugin.paperHub.savePromptToVault(
								entry,
								snap
							);
							entry.vaultPath = savedPath;
							entry.content = snap;
							await this.plugin.saveSettings();
							new Notice(`Restored snapshot for ${entry.name}.`);
							this.display();
						}
					).open();
				});
			}

			if (entry.builtIn) {
				addActionBtn(actions, 'Reset', () => {
					const builtInDefault = this.plugin.paperHub.getBuiltInDefaultContent(
						entry.id
					);
					if (!builtInDefault) return;
					new ConfirmActionModal(
						this.app,
						`Reset "${entry.name}"?`,
						`Reset ${entryPath} to the built-in default prompt?`,
						'Reset',
						async () => {
							entry.vaultPath = entryPath;
							const savedPath = await this.plugin.paperHub.savePromptToVault(
								entry,
								builtInDefault
							);
							entry.vaultPath = savedPath;
							entry.content = builtInDefault;
							await this.plugin.saveSettings();
							new Notice(`Reset ${entry.name} to default.`);
							this.display();
						}
					).open();
				});
			} else {
				addActionBtn(actions, 'Delete', () => {
					new ConfirmActionModal(
						this.app,
						`Delete "${entry.name}"?`,
						'Remove this custom prompt from plugin settings? (Any existing .md file in your Vault is preserved.)',
						'Delete',
						async () => {
							this.plugin.settings.prompts =
								this.plugin.settings.prompts.filter(
									(p) => p.id !== entry.id
								);
							await this.plugin.saveSettings();
							new Notice(`Deleted prompt "${entry.name}".`);
							this.display();
						}
					).open();
				});
			}
		}
	}

	// -------------------------------------------------------------------------
	// TAB 4: MODULAR WEBHOOKS
	// -------------------------------------------------------------------------
	renderWebhookSettings(container: HTMLElement): void {
		const topCard = container.createDiv({ cls: 'zotero-setting-card' });
		topCard.createEl('h3', { text: 'Modular Webhooks', cls: 'zotero-card-title' });
		topCard.createDiv({
			text: "Configure modular webhooks for deep research, synthesis, or custom pipelines. Toggle 'Show in Assistant' to display them in note toolbars.",
			cls: 'setting-item-description zotero-desc-tight',
		});

		new Setting(topCard)
			.setName('Show webhook icon in sidebar')
			.setDesc(
				'Add an icon in the left sidebar to quickly trigger a webhook for the active note.'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.webhookShowInRibbon)
					.onChange(async (value) => {
						this.plugin.settings.webhookShowInRibbon = value;
						await this.plugin.saveSettings();
						this.plugin.updateWebhookRibbonIcon();
					})
			);

		const debugWarningEl = topCard.createDiv({
			cls: 'zotero-webhook-debug-banner',
		});
		debugWarningEl.createSpan({
			text: 'Debug mode logs full request headers and body to the console. Only enable temporarily while troubleshooting.',
		});

		new Setting(topCard)
			.setName('Debug mode')
			.setDesc(
				'Log webhook request headers and body to the developer console (Ctrl/Cmd+Shift+I) when triggered.'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.webhookDebugMode)
					.onChange(async (value) => {
						if (value) {
							new WebhookDebugConfirmModal(
								this.app,
								async () => {
									this.plugin.settings.webhookDebugMode = true;
									await this.plugin.saveSettings();
								},
								() => {
									this.plugin.settings.webhookDebugMode = false;
									toggle.setValue(false);
								}
							).open();
						} else {
							this.plugin.settings.webhookDebugMode = false;
							await this.plugin.saveSettings();
						}
					})
			);

		const webhookList = container.createDiv({ cls: 'zotero-settings-list' });

		this.plugin.settings.webhooks.forEach((hook, idx) => {
			const box = webhookList.createDiv({
				cls: 'zotero-setting-block zotero-webhook-row',
			});

			const titleDiv = box.createDiv({
				cls: `zotero-webhook-row-title ${hook.hidden ? 'is-hidden-hook' : ''}`,
			});
			if (hook.icon) {
				const iconSpan = titleDiv.createSpan({ cls: 'zotero-webhook-icon' });
				setIcon(iconSpan, hook.icon);
			}
			titleDiv.createSpan({
				text: hook.name + (hook.hidden ? ' (Hidden)' : ''),
			});

			const btnGroup = box.createDiv({ cls: 'zotero-webhook-row-actions' });
			new ButtonComponent(btnGroup).setButtonText('Edit').onClick(() => {
				new WebhookEditModal(
					this.app,
					hook,
					async (updated) => {
						this.plugin.settings.webhooks[idx] = updated;
						await this.plugin.saveSettings();
						this.display();
					},
					this.plugin.settings.prompts
				).open();
			});

			new ButtonComponent(btnGroup).setIcon('trash').onClick(async () => {
				this.plugin.settings.webhooks.splice(idx, 1);
				await this.plugin.saveSettings();
				this.display();
			});
		});

		new ButtonComponent(container.createDiv({ cls: 'zotero-setting-center-btn' }))
			.setButtonText('+ Create Webhook')
			.setCta()
			.onClick(() => {
				const newHook: WebhookProfile = {
					id: Date.now().toString(),
					name: 'New Webhook',
					url: '',
					method: 'POST',
					icon: 'send',
					headers: [],
					bodyTemplate:
						'{\n  "citekey": "{{citekey}}",\n  "zotero_note": "{{path.zotero_note}}",\n  "report1": "{{path.report1}}",\n  "report2": "{{path.report2}}",\n  "takeaway": "{{path.takeaway}}"\n}',
					hidden: false,
					contentType: 'json',
					inputVariables: [],
				};
				new WebhookEditModal(
					this.app,
					newHook,
					async (hook) => {
						this.plugin.settings.webhooks.push(hook);
						await this.plugin.saveSettings();
						this.display();
					},
					this.plugin.settings.prompts
				).open();
			});
	}

	// -------------------------------------------------------------------------
	// TAB 5: CFP (Call For Paper)
	// -------------------------------------------------------------------------
	renderCFPSettings(container: HTMLElement): void {
		container.createDiv({
			text: 'Call For Paper: store CFPs as notes. Add URLs to fetch from WikiCFP, CCFDDL (YAML), EasyChair, or OpenResearch; or use WikiCFP Conf Series (A–Z) as core; or add entries manually.',
			cls: 'setting-item-description zotero-cfp-intro-banner',
		});

		// === BASIC SETTINGS CARD ===
		const basicCard = container.createDiv({ cls: 'zotero-setting-card' });
		basicCard.createEl('h3', { text: 'Basic Settings', cls: 'zotero-card-title' });

		new Setting(basicCard)
			.setName('CFP note folder')
			.setDesc('Folder where CFP notes are stored (one note per acronym).')
			.addText((text) =>
				text
					.setValue(this.plugin.settings.cfpNoteDir)
					.onChange(async (value) => {
						this.plugin.settings.cfpNoteDir = value || 'CFP';
						await this.plugin.saveSettings();
					})
			);

		new Setting(basicCard)
			.setName('Default tags')
			.setDesc('Tags applied to CFP notes (one per line or comma-separated).')
			.addTextArea((text) => {
				text.setValue((this.plugin.settings.cfpDefaultTags || []).join(', '))
					.setPlaceholder('cfp, conference')
					.onChange(async (value) => {
						this.plugin.settings.cfpDefaultTags = value
							.split(/[,\n]/)
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 2;
			});

		new Setting(basicCard)
			.setName('URL sources refresh (days)')
			.setDesc(
				'Refresh from WikiCFP URLs, CCFDDL, EasyChair, OpenResearch every N days (default 5). Set 0 to disable.'
			)
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.cfpRefreshDays ?? 5))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						this.plugin.settings.cfpRefreshDays = isNaN(n)
							? 5
							: Math.max(0, n);
						await this.plugin.saveSettings();
					})
			);

		new Setting(basicCard)
			.setName('Series scan interval (days)')
			.setDesc(
				'Refresh from WikiCFP Conference Series (A–Z) every N days (default 30). Independent from URL sources. Set 0 to disable auto series scan.'
			)
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.cfpSeriesRefreshDays ?? 30))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						this.plugin.settings.cfpSeriesRefreshDays = isNaN(n)
							? 30
							: Math.max(0, n);
						await this.plugin.saveSettings();
					})
			);

		new Setting(basicCard)
			.setName('Conference acronym key (for CFP link)')
			.setDesc(
				'Frontmatter key to read conference acronym for direct CFP match in Assistant (e.g. conference-acronym).'
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.cfpAcronymKey ?? 'conference-acronym')
					.setPlaceholder('conference-acronym')
					.onChange(async (value) => {
						this.plugin.settings.cfpAcronymKey = (
							value || 'conference-acronym'
						).trim();
						await this.plugin.saveSettings();
					})
			);

		// === WIKICFP SERIES CARD ===
		const seriesCard = container.createDiv({ cls: 'zotero-setting-card' });
		seriesCard.createEl('h3', {
			text: 'WikiCFP Conference Series',
			cls: 'zotero-card-title',
		});
		seriesCard.createDiv({
			text: "Load conference series from WikiCFP's A–Z index. Select specific letters to reduce crawling risk. Auto-refresh uses all configured sources.",
			cls: 'setting-item-description zotero-desc-tight',
		});

		const lettersSection = seriesCard.createDiv({
			cls: 'zotero-cfp-letters-section',
		});
		lettersSection.createEl('h4', {
			text: 'Index Letters',
			cls: 'zotero-cfp-filter-title',
		});
		lettersSection.createDiv({
			text: 'Select letters to load (empty = all A-Z):',
			cls: 'setting-item-description zotero-desc-tight',
		});

		const lettersContainer = lettersSection.createDiv({
			cls: 'zotero-cfp-letters-container',
		});
		const allLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
		const selectedLetters = Array.isArray(this.plugin.settings.cfpSeriesIndexLetters)
			? new Set(this.plugin.settings.cfpSeriesIndexLetters)
			: new Set<string>();

		const checkboxes: HTMLInputElement[] = [];

		allLetters.forEach((letter) => {
			const letterItem = lettersContainer.createDiv({
				cls: 'zotero-cfp-letter-item',
			});
			const checkbox = letterItem.createEl('input', {
				type: 'checkbox',
				attr: { value: letter, id: `cfp-letter-${letter}` },
				cls: 'zotero-cfp-letter-checkbox',
			}) as HTMLInputElement;
			const label = letterItem.createEl('label', {
				text: letter,
				attr: { for: `cfp-letter-${letter}` },
				cls: 'zotero-cfp-letter-label',
			});
			checkbox.checked = selectedLetters.has(letter);
			checkboxes.push(checkbox);
			const updateSettings = async () => {
				const current = Array.isArray(this.plugin.settings.cfpSeriesIndexLetters)
					? [...this.plugin.settings.cfpSeriesIndexLetters]
					: [];
				if (checkbox.checked) {
					if (!current.includes(letter)) current.push(letter);
				} else {
					const idx = current.indexOf(letter);
					if (idx >= 0) current.splice(idx, 1);
				}
				this.plugin.settings.cfpSeriesIndexLetters = current.sort();
				await this.plugin.saveSettings();
			};
			checkbox.onchange = updateSettings;
			letterItem.onclick = (e) => {
				if (e.target !== checkbox && e.target !== label) {
					checkbox.checked = !checkbox.checked;
					void updateSettings();
				}
			};
		});

		const actionsRow = seriesCard.createDiv({
			cls: 'zotero-cfp-series-actions-row',
		});
		new ButtonComponent(actionsRow).setButtonText('Select All').onClick(async () => {
			checkboxes.forEach((cb) => (cb.checked = true));
			this.plugin.settings.cfpSeriesIndexLetters = allLetters.slice();
			await this.plugin.saveSettings();
		});
		new ButtonComponent(actionsRow)
			.setButtonText('Deselect All')
			.onClick(async () => {
				checkboxes.forEach((cb) => (cb.checked = false));
				this.plugin.settings.cfpSeriesIndexLetters = [];
				await this.plugin.saveSettings();
			});
		new ButtonComponent(actionsRow)
			.setButtonText('Refresh Series')
			.setCta()
			.onClick(() => {
				new Notice('WikiCFP series refresh started. Notices will show progress.');
				this.plugin.cfpService
					.refreshWikiCFPSeries((msg) => new Notice(msg))
					.then(() => new Notice('WikiCFP series refresh done.'))
					.catch(() =>
						new Notice('WikiCFP series refresh failed. See console.')
					);
			});

		// === DATAVIEWJS CODE CARD ===
		const codeCard = container.createDiv({ cls: 'zotero-setting-card' });
		codeCard.createEl('h3', {
			text: 'Series Note DataviewJS Code',
			cls: 'zotero-card-title',
		});
		codeCard.createDiv({
			text: 'Custom DataviewJS code for the refresh button in Series notes. Changes apply to all existing Series notes immediately.',
			cls: 'setting-item-description zotero-desc-tight',
		});
		const scriptWrapper = codeCard.createDiv({ cls: 'zotero-cfp-script-wrapper' });
		mountCodeMirror(
			scriptWrapper,
			this.plugin.settings.cfpSeriesDataviewJSCode || '',
			'javascript',
			async (val) => {
				this.plugin.settings.cfpSeriesDataviewJSCode = val;
				await this.plugin.saveSettings();
				const updated =
					await this.plugin.cfpService.updateAllSeriesNotesDataviewJS();
				if (updated > 0) {
					new Notice(`Updated ${updated} Series notes with new code.`);
				}
			},
			{ height: '250px' }
		);
		const updateBtnRow = codeCard.createDiv({ cls: 'zotero-cfp-code-actions-row' });
		new ButtonComponent(updateBtnRow)
			.setButtonText('Update All Series Notes')
			.onClick(async () => {
				new Notice('Updating all Series notes...');
				const updated =
					await this.plugin.cfpService.updateAllSeriesNotesDataviewJS();
				new Notice(`Updated ${updated} Series notes.`);
			});

		// === URL SOURCES CARD ===
		const urlsCard = container.createDiv({ cls: 'zotero-setting-card' });
		urlsCard.createEl('h3', { text: 'URL Sources', cls: 'zotero-card-title' });
		urlsCard.createDiv({
			text: 'Add URLs from different sources to fetch CFP data. Each source type is managed separately.',
			cls: 'setting-item-description zotero-desc-tight',
		});

		const cfpUrlsWrapper = urlsCard.createDiv({ cls: 'zotero-cfp-urls-sections' });

		const renderUrlSourceSection = (
			title: string,
			desc: string,
			getList: () => string[],
			setList: (next: string[]) => void,
			onRefresh: () => void
		) => {
			const sec = cfpUrlsWrapper.createDiv({ cls: 'zotero-cfp-url-section' });
			const header = sec.createDiv({ cls: 'zotero-cfp-url-section-header' });
			header.createEl('h4', { text: title, cls: 'zotero-cfp-url-section-title' });
			new ButtonComponent(header)
				.setButtonText('Refresh')
				.setCta()
				.onClick(onRefresh);
			sec.createDiv({
				text: desc,
				cls: 'setting-item-description zotero-cfp-url-desc',
			});

			const addRow = sec.createDiv({
				cls: 'zotero-setting-block zotero-cfp-add-row',
			});
			const inputWrap = addRow.createDiv({ cls: 'zotero-flex-1' });
			const urlInput = new TextComponent(inputWrap);
			urlInput.setPlaceholder('https://...');
			urlInput.inputEl.addClass('zotero-input-wide');

			new ButtonComponent(addRow).setButtonText('Add URL').onClick(async () => {
				const val = urlInput.getValue()?.trim();
				if (!val) return;
				const current = [...getList(), val];
				setList(current);
				await this.plugin.saveSettings();
				urlInput.setValue('');
				this.display();
			});

			const listEl = sec.createDiv({ cls: 'zotero-settings-list' });
			getList().forEach((url, idx) => {
				const row = listEl.createDiv({ cls: 'zotero-setting-block' });
				row.createSpan({
					text: url || '(empty)',
					cls: 'zotero-cfp-url-display zotero-flex-1',
				});
				new ButtonComponent(row).setIcon('trash').onClick(async () => {
					const next = [...getList()];
					next.splice(idx, 1);
					setList(next);
					await this.plugin.saveSettings();
					this.display();
				});
			});
		};

		renderUrlSourceSection(
			'WikiCFP URLs',
			'e.g. http://www.wikicfp.com/cfp/call?conference=machine%20learning',
			() => this.plugin.settings.cfpWikicfpUrls || [],
			(next) => {
				this.plugin.settings.cfpWikicfpUrls = next;
			},
			() => this.plugin.cfpService.refreshWikiCFPUrls()
		);

		renderUrlSourceSection(
			'CCFDDL URLs (YAML)',
			'Single YAML URL with all conferences. e.g. https://ccfddl.com/conference/allconf.yml',
			() => this.plugin.settings.cfpCcfddlUrls || [],
			(next) => {
				this.plugin.settings.cfpCcfddlUrls = next;
			},
			() => this.plugin.cfpService.refreshCcfddlUrls()
		);

		renderUrlSourceSection(
			'EasyChair URLs',
			'e.g. https://easychair.org/cfp/area.cgi?area=1',
			() => this.plugin.settings.cfpEasychairUrls || [],
			(next) => {
				this.plugin.settings.cfpEasychairUrls = next;
			},
			() => this.plugin.cfpService.refreshEasychairUrls()
		);

		renderUrlSourceSection(
			'OpenResearch URLs',
			'e.g. https://www.openresearch.org/mediawiki/index.php?title=Events&field=Science&type=Science',
			() => this.plugin.settings.cfpOpenresearchUrls || [],
			(next) => {
				this.plugin.settings.cfpOpenresearchUrls = next;
			},
			() => this.plugin.cfpService.refreshOpenresearchUrls()
		);

		// === RANKING SOURCES CARD ===
		const rankCard = container.createDiv({ cls: 'zotero-setting-card' });
		rankCard.createEl('h3', { text: 'Ranking Sources', cls: 'zotero-card-title' });
		rankCard.createDiv({
			text: 'Configure local files for ranking metadata. CORE rankings are loaded from a local CSV; CCF rankings are loaded from allconf.yml.',
			cls: 'setting-item-description zotero-desc-tight',
		});

		new Setting(rankCard)
			.setName('CORE CSV path')
			.setDesc(
				'Vault-relative path to CORE.csv. When set, this is the authoritative source for CORE ranks (A*, A, B, C).'
			)
			.addText((text) =>
				text
					.setPlaceholder('e.g. CFP/CORE/CORE-ICORE2026.csv')
					.setValue(this.plugin.settings.cfpCoreCsvPath || '')
					.onChange(async (value) => {
						this.plugin.settings.cfpCoreCsvPath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(rankCard)
			.setName('Local allconf.yml path')
			.setDesc(
				'Optional vault-relative path to a local copy of allconf.yml used as fallback for CCF ranks.'
			)
			.addText((text) =>
				text
					.setPlaceholder('e.g. CFP/CCF/allconf.yml')
					.setValue(this.plugin.settings.cfpCcfddlLocalPath || '')
					.onChange(async (value) => {
						this.plugin.settings.cfpCcfddlLocalPath = value.trim();
						await this.plugin.saveSettings();
					})
			);

		// === ACTIONS CARD ===
		const actionsCard = container.createDiv({ cls: 'zotero-setting-card' });
		actionsCard.createEl('h3', { text: 'Actions', cls: 'zotero-card-title' });
		const btnRow = actionsCard.createDiv({ cls: 'zotero-cfp-actions-row' });
		new ButtonComponent(btnRow)
			.setButtonText('Refresh All Sources')
			.setCta()
			.onClick(async () => {
				await this.plugin.cfpService.refresh();
			});
		new ButtonComponent(btnRow)
			.setButtonText('Add Manual CFP')
			.setCta()
			.onClick(() => {
				import('./ui/cfp-manual-modal').then(({ CFPManualModal }) => {
					new CFPManualModal(
						this.app,
						this.plugin.settings.cfpDefaultTags || [],
						(item) => {
							this.plugin.cfpService
								.saveManualCFP(item)
								.then(() => new Notice('CFP note created.'))
								.catch(() => new Notice('Failed to create CFP note.'));
						}
					).open();
				});
			});

		const diagRow = actionsCard.createDiv({ cls: 'zotero-cfp-actions-row' });
		new ButtonComponent(diagRow)
			.setButtonText('Check ranking sources')
			.onClick(async () => {
				const s = this.plugin.settings;
				const corePath = (s.cfpCoreCsvPath || '').trim();
				const ccfLocal = (s.cfpCcfddlLocalPath || '').trim();
				const messages: string[] = [];

				if (corePath) {
					const normalized = normalizePath(corePath);
					const file = this.app.vault.getAbstractFileByPath(normalized);
					messages.push(
						file
							? `CORE CSV: found at ${normalized}`
							: `CORE CSV: not found at ${normalized}`
					);
				} else {
					messages.push('CORE CSV: path not set.');
				}

				if (ccfLocal) {
					const normalized = normalizePath(ccfLocal);
					const file = this.app.vault.getAbstractFileByPath(normalized);
					messages.push(
						file
							? `Local allconf.yml: found at ${normalized}`
							: `Local allconf.yml: not found at ${normalized}`
					);
				} else {
					messages.push('Local allconf.yml: path not set.');
				}

				new Notice(messages.join('\n'));
			});
	}
}

export class IconSuggestModal extends FuzzySuggestModal<string> {
	callback: (icon: string) => void;

	constructor(app: App, callback: (icon: string) => void) {
		super(app);
		this.callback = callback;
	}

	getItems(): string[] {
		return getIconIds();
	}

	getItemText(icon: string): string {
		return icon;
	}

	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
		el.addClass('mod-icon-suggestion');
		const iconName = match.item;
		const iconContainer = el.createDiv({ cls: 'suggestion-icon' });
		setIcon(iconContainer, iconName);
		el.createDiv({ text: iconName });
	}

	onChooseItem(icon: string): void {
		this.callback(icon);
	}
}

class WebhookDebugConfirmModal extends Modal {
	onConfirm: () => void | Promise<void>;
	onCancel: () => void;

	constructor(
		app: App,
		onConfirm: () => void | Promise<void>,
		onCancel: () => void
	) {
		super(app);
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('zotero-webhook-debug-confirm-modal');

		contentEl.createEl('h2', { text: 'Enable Webhook Debug Mode?' });

		const warning = contentEl.createDiv({ cls: 'zotero-debug-confirm-warning' });
		warning.createEl('p', {
			text: 'Debug mode logs full request headers and body to the developer console. This may expose:',
		});
		const list = warning.createEl('ul');
		list.createEl('li', { text: 'API keys and authentication tokens' });
		list.createEl('li', { text: 'Secret header values' });
		list.createEl('li', { text: 'Sensitive data in the request body' });
		warning.createEl('p', {
			text: 'Only enable when debugging. Turn it off when done.',
		});

		const footer = contentEl.createDiv({ cls: 'zotero-modal-footer' });
		new ButtonComponent(footer).setButtonText('Cancel').onClick(() => {
			this.onCancel();
			this.close();
		});

		new ButtonComponent(footer)
			.setButtonText('Enable anyway')
			.setWarning()
			.onClick(async () => {
				await this.onConfirm();
				this.close();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class WebhookEditModal extends Modal {
	webhook: WebhookProfile;
	onSave: (hook: WebhookProfile) => void;
	prompts: PromptTemplateEntry[];
	jsonEditor: EditorView | null = null;

	constructor(
		app: App,
		webhook: WebhookProfile,
		onSave: (hook: WebhookProfile) => void,
		prompts: PromptTemplateEntry[] = []
	) {
		super(app);
		this.webhook = JSON.parse(JSON.stringify(webhook)) as WebhookProfile;
		this.onSave = onSave;
		this.prompts = prompts;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('zotero-modal-wide');

		contentEl.createEl('h2', { text: 'Edit Webhook' });

		// 1. Basic Info
		const infoContainer = contentEl.createDiv({ cls: 'zotero-setting-group' });
		new Setting(infoContainer)
			.setName('Name')
			.addText((t) =>
				t.setValue(this.webhook.name).onChange((v) => (this.webhook.name = v))
			);

		new Setting(infoContainer)
			.setName('Show in Assistant')
			.setDesc('Display as an icon button in the note Assistant toolbar.')
			.addToggle((t) =>
				t
					.setValue(!this.webhook.hidden)
					.onChange((v) => (this.webhook.hidden = !v))
			);

		const iconSetting = new Setting(infoContainer).setName('Icon');
		const iconContainer = iconSetting.controlEl.createDiv({
			cls: 'zotero-icon-control',
		});

		const previewEl = iconContainer.createDiv({ cls: 'zotero-icon-preview-box' });
		setIcon(previewEl, this.webhook.icon || 'help-circle');

		const iconSearcher = new ButtonComponent(iconContainer);
		iconSearcher
			.setButtonText(this.webhook.icon || 'Select')
			.setIcon('search')
			.onClick(() => {
				new IconSuggestModal(this.app, (selectedIcon) => {
					this.webhook.icon = selectedIcon;
					previewEl.empty();
					setIcon(previewEl, selectedIcon);
					iconSearcher.setButtonText(selectedIcon);
				}).open();
			});

		// 2. Request Details
		const reqContainer = contentEl.createDiv({ cls: 'zotero-setting-group' });
		new Setting(reqContainer).setName('URL').addText((t) =>
			t
				.setValue(this.webhook.url)
				.onChange((v) => (this.webhook.url = v))
				.inputEl.addClass('zotero-input-wide')
		);

		new Setting(reqContainer)
			.setName('Method')
			.addDropdown((d) =>
				d
					.addOption('POST', 'POST')
					.addOption('GET', 'GET')
					.addOption('PUT', 'PUT')
					.addOption('DELETE', 'DELETE')
					.setValue(this.webhook.method)
					.onChange((v) => (this.webhook.method = v as WebhookProfile['method']))
			);

		new Setting(reqContainer)
			.setName('Body Content Type')
			.setDesc('Sets the Content-Type header and body format.')
			.addDropdown((d) =>
				d
					.addOption('json', 'JSON (application/json)')
					.addOption('text', 'Plain Text (text/plain)')
					.addOption('form', 'Form (x-www-form-urlencoded)')
					.setValue(this.webhook.contentType || 'json')
					.onChange(
						(v) =>
							(this.webhook.contentType =
								v as WebhookProfile['contentType'])
					)
			);

		// 4. Body Template & Usage Guide
		contentEl.createEl('h4', { text: 'Body Template (JSON)' });

		const legacy = (
			this.webhook as WebhookProfile & { inputVariable?: WebhookInputVariable }
		).inputVariable;
		if (legacy && !this.webhook.inputVariables?.length) {
			this.webhook.inputVariables = [legacy];
			delete (this.webhook as { inputVariable?: unknown }).inputVariable;
		}
		if (!this.webhook.inputVariables) this.webhook.inputVariables = [];

		// Input variables
		contentEl.createEl('h4', {
			text: 'Input variables',
			cls: 'zotero-input-vars-heading',
		});
		contentEl.createDiv({
			cls: 'setting-item-description zotero-desc-tight',
			text: 'Optional variables prompted when triggering this webhook. Use {{name}} in the body template.',
		});
		const inputVarsList = contentEl.createDiv({ cls: 'zotero-input-vars-list' });
		const renderInputVars = () => {
			inputVarsList.empty();
			this.webhook.inputVariables!.forEach((iv, idx) => {
				const card = inputVarsList.createDiv({ cls: 'zotero-input-var-card' });
				const row = card.createDiv({ cls: 'zotero-input-var-row' });
				new TextComponent(row)
					.setPlaceholder('Variable name (e.g. custom)')
					.setValue(iv.name)
					.onChange((v) => (iv.name = v.trim()))
					.inputEl.addClass('zotero-input-var-name');
				new DropdownComponent(row)
					.addOption('text', 'Text')
					.addOption('number', 'Number')
					.setValue(iv.type)
					.onChange((v) => (iv.type = v as 'text' | 'number'))
					.selectEl.addClass('zotero-input-var-type');
				new ButtonComponent(row)
					.setIcon('trash-2')
					.setTooltip('Remove')
					.onClick(() => {
						this.webhook.inputVariables!.splice(idx, 1);
						renderInputVars();
					})
					.buttonEl.addClass('zotero-input-var-remove');
			});
			const addWrap = inputVarsList.createDiv({
				cls: 'zotero-input-var-add-wrap',
			});
			new ButtonComponent(addWrap)
				.setButtonText('+ Add input variable')
				.setIcon('plus')
				.setCta()
				.onClick(() => {
					this.webhook.inputVariables!.push({ name: '', type: 'text' });
					renderInputVars();
				})
				.buttonEl.addClass('zotero-btn-fancy', 'zotero-input-var-add-btn');
		};
		renderInputVars();

		// Quick Insert Placeholders Chip Bar
		const chipSection = contentEl.createDiv({ cls: 'zotero-placeholder-bar' });
		chipSection.createDiv({
			cls: 'zotero-placeholder-bar-title',
			text: 'Quick Insert Placeholders (click to insert at cursor):',
		});
		const chipContainer = chipSection.createDiv({
			cls: 'zotero-placeholder-chips',
		});

		const promptEntries = this.prompts.filter(
			(p) => (p.kind ?? 'prompt') === 'prompt'
		);
		const quickTokens = [
			'{{citekey}}',
			'{{path.zotero_note}}',
			'{{path.report1}}',
			'{{path.report2}}',
			'{{path.takeaway}}',
			'{{path.core_note}}',
			...promptEntries.map((p) => `{{prompt.${p.id}}}`),
			...promptEntries.map((p) => `{{path.prompt.${p.id}}}`),
			'{{filename}}',
			'{{content}}',
		];

		for (const token of quickTokens) {
			const chip = chipContainer.createEl('button', {
				cls: 'zotero-placeholder-chip',
				text: token,
				attr: { type: 'button' },
			});
			chip.onclick = () => {
				if (!this.jsonEditor) return;
				const sel = this.jsonEditor.state.selection.main;
				this.jsonEditor.dispatch({
					changes: { from: sel.from, to: sel.to, insert: token },
					selection: { anchor: sel.from + token.length },
				});
				this.jsonEditor.focus();
			};
		}

		// JSON Control Bar
		const jsonControls = contentEl.createDiv({ cls: 'zotero-json-controls' });
		new ButtonComponent(jsonControls)
			.setButtonText('Format JSON')
			.setIcon('code-glyph')
			.setTooltip('Prettify JSON')
			.onClick(() => {
				if (!this.jsonEditor) return;
				try {
					const current = this.jsonEditor.state.doc.toString();
					if (!current.trim()) return;
					const formatted = JSON.stringify(JSON.parse(current), null, 2);
					this.jsonEditor.dispatch({
						changes: { from: 0, to: current.length, insert: formatted },
					});
					new Notice('JSON Formatted!');
				} catch {
					new Notice('Invalid JSON, cannot format.');
				}
			});

		const jsonWrapper = contentEl.createDiv();
		this.jsonEditor = mountCodeMirror(
			jsonWrapper,
			this.webhook.bodyTemplate,
			'json',
			(val) => {
				this.webhook.bodyTemplate = val;
			},
			{ height: '250px' }
		);

		// 5. Headers
		contentEl.createEl('h4', { text: 'Custom Headers' });
		const headerContainer = contentEl.createDiv();

		let availableSecrets: string[] = [];
		if (this.app.secretStorage && this.app.secretStorage.listSecrets) {
			try {
				availableSecrets = await this.app.secretStorage.listSecrets();
			} catch {
				/* secrets are optional */
			}
		}

		const refreshHeaders = () => {
			headerContainer.empty();
			this.webhook.headers.forEach((h, i) => {
				const row = headerContainer.createDiv({ cls: 'zotero-setting-block' });

				new TextComponent(row)
					.setPlaceholder('Key')
					.setValue(h.key)
					.onChange((v) => (h.key = v))
					.inputEl.addClass('zotero-flex-1');

				new DropdownComponent(row)
					.addOption('text', 'Text')
					.addOption('secret', 'Secret')
					.setValue(h.type || 'text')
					.onChange((v) => {
						h.type = v as 'text' | 'secret';
						h.value = '';
						refreshHeaders();
					});

				if (h.type === 'secret') {
					const dd = new DropdownComponent(row);
					dd.addOption('', '-- Select Secret --');
					availableSecrets.forEach((s) => dd.addOption(s, s));
					dd.setValue(h.value);
					dd.onChange((v) => (h.value = v));
					if (availableSecrets.length === 0) dd.setDisabled(true);
					dd.selectEl.addClass('zotero-flex-2');
				} else {
					new TextComponent(row)
						.setPlaceholder('Value')
						.setValue(h.value)
						.onChange((v) => (h.value = v))
						.inputEl.addClass('zotero-flex-2');
				}

				new ButtonComponent(row).setIcon('trash').onClick(() => {
					this.webhook.headers.splice(i, 1);
					refreshHeaders();
				});
			});

			new ButtonComponent(headerContainer)
				.setButtonText('+ Add Header')
				.onClick(() => {
					this.webhook.headers.push({ key: '', value: '', type: 'text' });
					refreshHeaders();
				});
		};
		refreshHeaders();

		// Footer
		const footer = contentEl.createDiv({ cls: 'zotero-modal-footer' });
		new ButtonComponent(footer)
			.setButtonText('Save Webhook')
			.setCta()
			.onClick(() => {
				if (this.webhook.inputVariables) {
					this.webhook.inputVariables = this.webhook.inputVariables.filter(
						(iv) => iv.name?.trim()
					);
				}
				this.onSave(this.webhook);
				this.close();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
