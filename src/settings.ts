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
	DEFAULT_PROMPTS,
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
		new ButtonComponent(footer).setButtonText('Cancel').onClick(() => this.close());
		const confirmBtn = new ButtonComponent(footer)
			.setButtonText(this.confirmLabel)
			.onClick(async () => {
				await this.onConfirm();
				this.close();
			});
		confirmBtn.setWarning?.();
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
	activePromptKey = 'zotero-template';

	constructor(app: App, plugin: ZoteroGKPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('zotero-settings-wrapper');

		// --- 1. Tab Navigation ---
		const tabsEl = containerEl.createDiv({ cls: 'zotero-settings-tabs' });

		this.renderTabItem(tabsEl, 'general', 'General');
		this.renderTabItem(tabsEl, 'zotero', 'Zotero & Highlights');
		this.renderTabItem(tabsEl, 'prompts', 'Templates & Prompts');
		this.renderTabItem(tabsEl, 'webhook', 'Modular Webhooks');
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
			text: 'Vault-relative path patterns for each paper resource. Use {{citekey}} for automatic citation-key substitution.',
			cls: 'setting-item-description zotero-desc-tight',
		});

		const addPathRow = (
			name: string,
			desc: string,
			key: keyof PaperWorkspaceConfig,
			defaultVal: string,
			afterSave?: (val: string) => void
		) => {
			const setting = new Setting(layoutCard).setName(name).setDesc(desc);
			let textRef: TextComponent | null = null;
			setting.addText((text) => {
				textRef = text;
				text.setPlaceholder(defaultVal)
					.setValue(ws[key])
					.onChange(async (val) => {
						ws[key] = val.trim();
						if (afterSave) afterSave(ws[key]);
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('zotero-workspace-path-input');
			});
			addSettingIconAction(
				setting.controlEl,
				'rotate-ccw',
				`Reset to default (${defaultVal})`,
				async () => {
					ws[key] = defaultVal;
					if (afterSave) afterSave(defaultVal);
					textRef?.setValue(defaultVal);
					await this.plugin.saveSettings();
				}
			);
		};

		addPathRow(
			'Zotero Note (Paper Manager)',
			'Primary literature note imported from Zotero.',
			'literatureNotePath',
			DEFAULT_PAPER_WORKSPACE.literatureNotePath
		);
		addPathRow(
			'Report 1 (Deep Research)',
			'Internal manuscript deep-dive report.',
			'report1Path',
			DEFAULT_PAPER_WORKSPACE.report1Path
		);
		addPathRow(
			'Report 2 (External Landscape)',
			'External research landscape & code discovery report.',
			'report2Path',
			DEFAULT_PAPER_WORKSPACE.report2Path
		);
		addPathRow(
			'Takeaway (Synthesized)',
			'Synthesized Zettelkasten Incubator takeaway note.',
			'takeawayPath',
			DEFAULT_PAPER_WORKSPACE.takeawayPath
		);
		addPathRow(
			'Core Note (Paper Note)',
			'Concise personal core claim, projects, and linked Zettels.',
			'coreNotePath',
			DEFAULT_PAPER_WORKSPACE.coreNotePath
		);
		addPathRow(
			'Highlight Notes (Fleeting)',
			'Folder where exported PDF highlight / fleeting notes are saved.',
			'highlightNotesFolder',
			DEFAULT_PAPER_WORKSPACE.highlightNotesFolder,
			(val) => {
				this.plugin.settings.fleetingNoteFolder = val;
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

		// Legacy Assistant Custom JS (Collapsible)
		const detailsEl = container.createEl('details', {
			cls: 'zotero-setting-card zotero-legacy-details',
		});
		if (this.plugin.settings.enableLegacyAssistantScript) {
			detailsEl.setAttribute('open', 'true');
		}
		detailsEl.createEl('summary', {
			text: 'Assistant Custom JS (Legacy DataviewJS)',
			cls: 'zotero-legacy-summary',
		});

		new Setting(detailsEl)
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

		const scriptHeaderRow = detailsEl.createDiv({ cls: 'zotero-legacy-script-bar' });
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

		const scriptWrapper = detailsEl.createDiv();
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
	// TAB 3: TEMPLATES & PROMPTS
	// -------------------------------------------------------------------------
	renderPromptsSettings(container: HTMLElement): void {
		const selectorRow = container.createDiv({ cls: 'zotero-prompt-pills' });

		const zoteroPill = selectorRow.createEl('button', {
			cls: `zotero-prompt-pill ${
				this.activePromptKey === 'zotero-template' ? 'is-active' : ''
			}`,
			text: 'Zotero Template',
			attr: { type: 'button' },
		});
		zoteroPill.onclick = () => {
			this.activePromptKey = 'zotero-template';
			this.display();
		};

		for (const prompt of this.plugin.settings.prompts) {
			const pill = selectorRow.createEl('button', {
				cls: `zotero-prompt-pill ${
					this.activePromptKey === prompt.id ? 'is-active' : ''
				}`,
				text: prompt.name,
				attr: { type: 'button' },
			});
			pill.onclick = () => {
				this.activePromptKey = prompt.id;
				this.display();
			};
		}

		const addPromptBtn = selectorRow.createEl('button', {
			cls: 'zotero-prompt-pill is-add',
			text: '+ New Prompt',
			attr: { type: 'button' },
		});
		addPromptBtn.onclick = async () => {
			const idx = this.plugin.settings.prompts.length + 1;
			const id = `custom_${Date.now().toString(36)}`;
			const entry: PromptTemplateEntry = {
				id,
				name: `Custom Prompt ${idx}`,
				vaultPath: `002-Literature/100-Prompts/${id}.md`,
				content: '# Custom Prompt\n\nWrite your prompt instructions here.\n',
				builtIn: false,
			};
			this.plugin.settings.prompts.push(entry);
			this.activePromptKey = id;
			await this.plugin.saveSettings();
			this.display();
		};

		if (this.activePromptKey === 'zotero-template') {
			this.renderZoteroTemplateEditor(container);
			return;
		}

		const selectedPrompt = this.plugin.settings.prompts.find(
			(p) => p.id === this.activePromptKey
		);
		if (!selectedPrompt) {
			this.activePromptKey = 'zotero-template';
			this.renderZoteroTemplateEditor(container);
			return;
		}
		this.renderPromptEntryEditor(container, selectedPrompt);
	}

	private renderZoteroTemplateEditor(container: HTMLElement): void {
		const connector = new ZoteroConnectorService(this.app, this.plugin.settings);
		const tplConfig = this.plugin.settings.zoteroTemplate;
		const card = container.createDiv({ cls: 'zotero-setting-card' });

		card.createEl('h3', {
			text: 'Zotero Integration Note Template (Nunjucks)',
			cls: 'zotero-card-title',
		});
		card.createDiv({
			text: 'Syncs with obsidian-zotero-desktop-connector export template. Use Detect to locate your active template file in the vault.',
			cls: 'setting-item-description zotero-desc-tight',
		});

		const pathRow = card.createDiv({ cls: 'zotero-template-path-row' });
		const pathInput = new TextComponent(pathRow);
		pathInput
			.setPlaceholder('e.g. 000-Templates/Zotero Literature.md')
			.setValue(tplConfig.vaultPath || '')
			.onChange(async (val) => {
				tplConfig.vaultPath = val.trim();
				await this.plugin.saveSettings();
			});
		pathInput.inputEl.addClass('zotero-input-wide');

		new ButtonComponent(pathRow).setButtonText('Detect').onClick(async () => {
			const detected = connector.detectTemplatePath();
			if (!detected) {
				new Notice(
					'Could not auto-detect template path from Zotero Desktop Connector.'
				);
				return;
			}
			tplConfig.vaultPath = detected;
			await this.plugin.saveSettings();
			new Notice(`Detected template: ${detected}`);
			this.display();
		});

		new ButtonComponent(pathRow).setButtonText('Load from File').onClick(async () => {
			const loaded = await connector.loadTemplateContent(tplConfig.vaultPath);
			if (!loaded.fromVault) {
				new Notice('Template file not found in vault; keeping current editor text.');
				return;
			}
			if (loaded.path) tplConfig.vaultPath = loaded.path;
			tplConfig.content = loaded.content;
			await this.plugin.saveSettings();
			new Notice(`Loaded template from ${loaded.path}`);
			this.display();
		});

		new ButtonComponent(pathRow)
			.setButtonText('Save to Vault File')
			.setCta()
			.onClick(async () => {
				const targetPath = tplConfig.vaultPath?.trim() || connector.detectTemplatePath();
				if (!targetPath) {
					new Notice('Set a Vault template path first.');
					return;
				}
				const savedPath = await connector.saveTemplateToVault(
					targetPath,
					tplConfig.content
				);
				tplConfig.vaultPath = savedPath;
				await this.plugin.saveSettings();
				new Notice(`Saved template to ${savedPath}`);
				this.display();
			});

		const actionsBar = card.createDiv({ cls: 'zotero-template-actions-bar' });
		new ButtonComponent(actionsBar).setButtonText('Copy').onClick(async () => {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(tplConfig.content);
				new Notice('Copied Zotero template to clipboard.');
			}
		});

		new ButtonComponent(actionsBar)
			.setButtonText('Save Snapshot')
			.onClick(async () => {
				tplConfig.snapshot = tplConfig.content;
				await this.plugin.saveSettings();
				new Notice('Saved Zotero template snapshot.');
				this.display();
			});

		if (tplConfig.snapshot) {
			new ButtonComponent(actionsBar)
				.setButtonText('Restore Snapshot')
				.onClick(() => {
					new ConfirmActionModal(
						this.app,
						'Restore Template Snapshot?',
						'Replace the current Zotero template content with your saved snapshot?',
						'Restore Snapshot',
						async () => {
							tplConfig.content = tplConfig.snapshot || tplConfig.content;
							await this.plugin.saveSettings();
							new Notice('Restored snapshot.');
							this.display();
						}
					).open();
				});
		}

		new ButtonComponent(actionsBar)
			.setButtonText('Reset to Default')
			.onClick(() => {
				new ConfirmActionModal(
					this.app,
					'Reset Zotero Template to Default?',
					'This replaces the template with the canonical Zotero Integration template (and updates the Vault file if a path is configured).',
					'Reset to Default',
					async () => {
						tplConfig.content = DEFAULT_ZOTERO_TEMPLATE;
						if (tplConfig.vaultPath?.trim()) {
							await connector.saveTemplateToVault(
								tplConfig.vaultPath,
								DEFAULT_ZOTERO_TEMPLATE
							);
						}
						await this.plugin.saveSettings();
						new Notice('Reset Zotero template to default.');
						this.display();
					}
				).open();
			});

		const editorWrap = card.createDiv({ cls: 'zotero-template-editor-wrap' });
		mountCodeMirror(
			editorWrap,
			tplConfig.content || DEFAULT_ZOTERO_TEMPLATE,
			'markdown',
			async (val) => {
				tplConfig.content = val;
				await this.plugin.saveSettings();
			},
			{ height: '380px', wrap: true }
		);
	}

	private renderPromptEntryEditor(
		container: HTMLElement,
		entry: PromptTemplateEntry
	): void {
		const card = container.createDiv({ cls: 'zotero-setting-card' });
		const topMeta = card.createDiv({ cls: 'zotero-prompt-meta-bar' });
		topMeta.createEl('h3', { text: entry.name, cls: 'zotero-card-title zotero-no-margin' });

		const chipsWrap = topMeta.createDiv({ cls: 'zotero-placeholder-chips' });
		for (const token of [`{{prompt.${entry.id}}}`, `{{path.prompt.${entry.id}}}`]) {
			const chip = chipsWrap.createEl('button', {
				cls: 'zotero-placeholder-chip',
				text: token,
				attr: { type: 'button', title: 'Click to copy placeholder' },
			});
			chip.onclick = async () => {
				if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(token);
					new Notice(`Copied ${token}`);
				}
			};
		}

		const fieldsGrid = card.createDiv({ cls: 'zotero-prompt-fields-grid' });
		new Setting(fieldsGrid).setName('Prompt Name').addText((text) =>
			text.setValue(entry.name).onChange(async (val) => {
				entry.name = val.trim() || entry.id;
				await this.plugin.saveSettings();
			})
		);

		new Setting(fieldsGrid)
			.setName('Vault .md Path')
			.setDesc('Synced prompt Markdown file in your vault.')
			.addText((text) => {
				text.setPlaceholder(`002-Literature/100-Prompts/${entry.id}.md`)
					.setValue(entry.vaultPath)
					.onChange(async (val) => {
						entry.vaultPath = val.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.addClass('zotero-workspace-path-input');
			});

		const actionsBar = card.createDiv({ cls: 'zotero-template-actions-bar' });
		new ButtonComponent(actionsBar)
			.setButtonText('Save to Vault File')
			.setCta()
			.onClick(async () => {
				const savedPath = await this.plugin.paperHub.savePromptToVault(
					entry,
					entry.content
				);
				entry.vaultPath = savedPath;
				await this.plugin.saveSettings();
				new Notice(`Saved prompt to ${savedPath}`);
				this.display();
			});

		new ButtonComponent(actionsBar)
			.setButtonText('Load from File')
			.onClick(async () => {
				const loaded = await this.plugin.paperHub.getPromptContent(entry.id);
				entry.content = loaded;
				await this.plugin.saveSettings();
				new Notice(`Loaded prompt content for ${entry.name}`);
				this.display();
			});

		new ButtonComponent(actionsBar)
			.setButtonText('Copy Prompt')
			.onClick(async () => {
				if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(entry.content);
					new Notice(`Copied ${entry.name} prompt.`);
				}
			});

		new ButtonComponent(actionsBar)
			.setButtonText('Save Snapshot')
			.onClick(async () => {
				entry.snapshot = entry.content;
				await this.plugin.saveSettings();
				new Notice('Saved prompt snapshot.');
				this.display();
			});

		if (entry.snapshot) {
			new ButtonComponent(actionsBar)
				.setButtonText('Restore Snapshot')
				.onClick(() => {
					new ConfirmActionModal(
						this.app,
						'Restore Prompt Snapshot?',
						`Replace "${entry.name}" with your saved snapshot?`,
						'Restore Snapshot',
						async () => {
							entry.content = entry.snapshot || entry.content;
							await this.plugin.saveSettings();
							new Notice('Restored prompt snapshot.');
							this.display();
						}
					).open();
				});
		}

		if (entry.builtIn) {
			new ButtonComponent(actionsBar)
				.setButtonText('Reset to Default')
				.onClick(() => {
					const builtInDefault = DEFAULT_PROMPTS.find((d) => d.id === entry.id);
					if (!builtInDefault) return;
					new ConfirmActionModal(
						this.app,
						`Reset "${entry.name}" to Default?`,
						'Overwrite current prompt text with the built-in canonical prompt?',
						'Reset to Default',
						async () => {
							entry.content = builtInDefault.content;
							if (entry.vaultPath?.trim()) {
								const f = this.app.vault.getAbstractFileByPath(
									normalizePath(entry.vaultPath.trim())
								);
								if (f) {
									await this.plugin.paperHub.savePromptToVault(
										entry,
										entry.content
									);
								}
							}
							await this.plugin.saveSettings();
							new Notice(`Reset ${entry.name} to default.`);
							this.display();
						}
					).open();
				});
		} else {
			new ButtonComponent(actionsBar)
				.setButtonText('Delete')
				.onClick(() => {
					new ConfirmActionModal(
						this.app,
						`Delete "${entry.name}"?`,
						'Remove this custom prompt from plugin settings? (Any existing vault .md file will not be deleted.)',
						'Delete Prompt',
						async () => {
							this.plugin.settings.prompts =
								this.plugin.settings.prompts.filter(
									(p) => p.id !== entry.id
								);
							this.activePromptKey = 'zotero-template';
							await this.plugin.saveSettings();
							this.display();
						}
					).open();
				});
		}

		const editorWrap = card.createDiv({ cls: 'zotero-template-editor-wrap' });
		mountCodeMirror(
			editorWrap,
			entry.content,
			'markdown',
			async (val) => {
				entry.content = val;
				await this.plugin.saveSettings();
			},
			{ height: '380px', wrap: true }
		);
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

		const quickTokens = [
			'{{citekey}}',
			'{{path.zotero_note}}',
			'{{path.report1}}',
			'{{path.report2}}',
			'{{path.takeaway}}',
			'{{path.core_note}}',
			...this.prompts.map((p) => `{{prompt.${p.id}}}`),
			...this.prompts.map((p) => `{{path.prompt.${p.id}}}`),
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
