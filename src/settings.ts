import {
	App,
	FuzzySuggestModal,
	FuzzyMatch,
	PluginSettingTab,
	Setting,
	ButtonComponent,
	TextComponent,
	ToggleComponent,
	TextAreaComponent,
	Modal,
	DropdownComponent,
	getIconIds,
	setIcon,
	Notice
} from 'obsidian';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import ZoteroGKPlugin from './main';
import { WebhookProfile, WebhookInputVariable } from './types';

// =========================================================================
// HELPER: Mount CodeMirror Editor
// =========================================================================
function mountCodeMirror(
	container: HTMLElement,
	initialValue: string,
	mode: 'javascript' | 'json',
	onChange: (value: string) => void,
	options: { height?: string, placeholder?: string } = {}
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
		oneDark // Keep a dark theme for code blocks
	];

	if (mode === 'javascript') extensions.push(javascript());
	if (mode === 'json') extensions.push(json());

	// Custom Theme for CSS overrides
	extensions.push(EditorView.theme({
		"&": {
			height: options.height || "300px",
			border: "1px solid var(--background-modifier-border)",
			borderRadius: "4px",
			fontSize: "13px"
		},
		".cm-scroller": { overflow: "auto" },
		".cm-content": { fontFamily: "var(--font-monospace)" }
	}));

	const startState = EditorState.create({
		doc: initialValue,
		extensions: extensions
	});

	const view = new EditorView({
		state: startState,
		parent: container
	});

	return view;
}

// =========================================================================
// MAIN SETTING TAB
// =========================================================================
export class ZoteroSettingTab extends PluginSettingTab {
	plugin: ZoteroGKPlugin;
	activeTab: 'general' | 'zotero' | 'webhook' | 'cfp' = 'general';

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
		this.renderTabItem(tabsEl, 'webhook', 'Modular Webhooks');
		this.renderTabItem(tabsEl, 'cfp', 'CFP');

		// --- 2. Tab Content ---
		const bodyEl = containerEl.createDiv({ cls: 'zotero-setting-container' });

		if (this.activeTab === 'general') this.renderGeneralSettings(bodyEl);
		else if (this.activeTab === 'zotero') this.renderZoteroSettings(bodyEl);
		else if (this.activeTab === 'webhook') this.renderWebhookSettings(bodyEl);
		else if (this.activeTab === 'cfp') this.renderCFPSettings(bodyEl);
	}

	renderTabItem(container: HTMLElement, id: 'general' | 'zotero' | 'webhook' | 'cfp', label: string) {
		const tab = container.createDiv({ cls: `zotero-tab-item ${this.activeTab === id ? 'active' : ''}` });
		tab.innerText = label;
		tab.onclick = () => {
			this.activeTab = id;
			this.display(); // Re-render
		};
	}

	// -------------------------------------------------------------------------
	// TAB 1: GENERAL
	// -------------------------------------------------------------------------
	renderGeneralSettings(container: HTMLElement) {
		new Setting(container)
			.setName('Zotero Port')
			.setDesc('Port for Better BibTeX JSON-RPC (Default: 23119)')
			.addText(text => text
				.setValue(String(this.plugin.settings.zoteroPort))
				.onChange(async (value) => {
					this.plugin.settings.zoteroPort = Number(value);
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('Fleeting Notes Folder')
			.setDesc('Folder where atomic notes will be created')
			.addText(text => text
				.setValue(this.plugin.settings.fleetingNoteFolder)
				.onChange(async (value) => {
					this.plugin.settings.fleetingNoteFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('Citation Key Name')
			.setDesc('A name used in the frontmatter to store the citation key for each note (e.g. "zotero-citation-key").')
			.addText(text => text
				.setValue(this.plugin.settings.citationKeyName)
				.onChange(async (value) => {
					this.plugin.settings.citationKeyName = value;
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('Annotation Key Name')
			.setDesc('A name used in the frontmatter to identify the annotation (e.g. "zotero-annotation-key").')
			.addText(text => text
				.setValue(this.plugin.settings.annotationKeyName)
				.onChange(async (value) => {
					this.plugin.settings.annotationKeyName = value;
					await this.plugin.saveSettings();
				}));

		container.createEl("h3", { text: "Project Linker" });

		new Setting(container)
			.setName('Projects Folder')
			.setDesc('Folder containing your project notes.')
			.addText(text => text
				.setValue(this.plugin.settings.projectsFolder)
				.onChange(async (value) => {
					this.plugin.settings.projectsFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(container)
			.setName('Project Frontmatter Key')
			.setDesc('The YAML key to update when a project is selected (e.g. "project" or "related-project").')
			.addText(text => text
				.setValue(this.plugin.settings.projectFrontmatterKey)
				.onChange(async (value) => {
					this.plugin.settings.projectFrontmatterKey = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(container)
			.setName('Project ID Key')
			.setDesc('Frontmatter key on project notes whose value is used as the link label (e.g. "project_id", "uuid", "alias"). If set, links show as [[note|value]]; otherwise [[note]].')
			.addText(text => text
				.setValue(this.plugin.settings.projectIdKey)
				.onChange(async (value) => {
					this.plugin.settings.projectIdKey = value;
					await this.plugin.saveSettings();
				}));
	}

	// -------------------------------------------------------------------------
	// TAB 2: ZOTERO & HIGHLIGHTS
	// -------------------------------------------------------------------------
	renderZoteroSettings(container: HTMLElement) {
		// Sorting
		new Setting(container)
			.setName('Default Annotation Sort')
			.setDesc('Property to sort highlights by in the review modal.')
			.addDropdown(dropdown => dropdown
				.addOption('color', 'Color (Group by Color)')
				.addOption('pageLabel', 'Page Number')
				.addOption('type', 'Annotation Type')
				.addOption('text', 'Content Text')
				.setValue(this.plugin.settings.sortProperty)
				.onChange(async (value) => {
					this.plugin.settings.sortProperty = value;
					await this.plugin.saveSettings();
				}));

		// Metadata Card
		container.createEl("h3", { text: "Metadata Verification" });
		const metaList = container.createDiv({ cls: 'zotero-settings-list' });

		this.plugin.settings.metadataMapping.forEach((item, index) => {
			const block = metaList.createDiv({ cls: 'zotero-setting-block' });
			block.style.display = 'flex';
			block.style.gap = '10px';
			block.style.alignItems = 'center';

			new ToggleComponent(block).setValue(item.enabled).onChange(async v => { item.enabled = v; await this.plugin.saveSettings(); });
			new TextComponent(block).setPlaceholder("Label").setValue(item.label).onChange(async v => { item.label = v; await this.plugin.saveSettings(); });
			new TextComponent(block).setPlaceholder("Zotero").setValue(item.zoteroProp).onChange(async v => { item.zoteroProp = v; await this.plugin.saveSettings(); });
			block.createSpan({ text: "➔" });
			new TextComponent(block).setPlaceholder("Note YAML").setValue(item.noteProp).onChange(async v => { item.noteProp = v; await this.plugin.saveSettings(); });

			new ButtonComponent(block).setIcon("trash").onClick(async () => {
				this.plugin.settings.metadataMapping.splice(index, 1);
				await this.plugin.saveSettings();
				this.display();
			});
		});

		new ButtonComponent(container.createDiv({ cls: "zotero-setting-center-btn" }))
			.setButtonText("+ Add Property")
			.onClick(async () => {
				this.plugin.settings.metadataMapping.push({ label: "New", zoteroProp: "", noteProp: "", enabled: true });
				await this.plugin.saveSettings();
				this.display();
			});

		// Script
		container.createEl("hr");
		container.createEl("h3", { text: "Assistant Custom JS" });
		container.createDiv({
			text: "Available params: container, file, app",
			cls: "setting-item-description zotero-desc-tight"
		});

		// --- [CodeMirror JS Editor] ---
		const scriptWrapper = container.createDiv();
		mountCodeMirror(
			scriptWrapper,
			this.plugin.settings.assistantScript,
			'javascript',
			async (val) => {
				this.plugin.settings.assistantScript = val;
				await this.plugin.saveSettings();
			},
			{ height: "300px" }
		);
	}

	// -------------------------------------------------------------------------
	// TAB 3: MODULAR WEBHOOKS
	// -------------------------------------------------------------------------
	renderWebhookSettings(container: HTMLElement) {
		container.createDiv({
			text: "Configure modular webhooks. Toggle 'Show in Assistant' to display them on the note.",
			cls: "setting-item-description"
		});

		new Setting(container)
			.setName('Show webhook icon in sidebar')
			.setDesc('Add an icon in the left sidebar to quickly trigger a webhook for the active note.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.webhookShowInRibbon)
				.onChange(async (value) => {
					this.plugin.settings.webhookShowInRibbon = value;
					await this.plugin.saveSettings();
					this.plugin.updateWebhookRibbonIcon();
				}));

		const debugWarningEl = container.createDiv({
			cls: 'setting-item-description',
			attr: {
				style: 'margin-bottom: 8px; padding: 10px; background: var(--background-modifier-error); color: var(--text-on-accent); border-radius: 6px; font-weight: 500;'
			}
		});
		debugWarningEl.createSpan({ text: '⚠️ ' });
		debugWarningEl.createSpan({
			text: 'Debug mode logs full request headers and body to the console. API keys, tokens, and other secrets may be exposed. Only enable when debugging and turn off afterwards.'
		});

		new Setting(container)
			.setName('Debug mode')
			.setDesc('When enabled, webhook request headers and body are logged to the developer console (Ctrl/Cmd+Shift+I) when you trigger a webhook. A confirmation is required when turning on.')
			.addToggle(toggle => toggle
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
				}));

		const webhookList = container.createDiv({ cls: 'zotero-settings-list' });

		this.plugin.settings.webhooks.forEach((hook, idx) => {
			const box = webhookList.createDiv({ cls: 'zotero-setting-block' });
			box.style.display = 'flex';
			box.style.alignItems = 'center';
			box.style.justifyContent = 'space-between';
			box.style.padding = '10px';

			const titleDiv = box.createDiv();
			titleDiv.style.display = 'flex';
			titleDiv.style.alignItems = 'center';
			titleDiv.style.gap = '10px';
			titleDiv.style.fontWeight = 'bold';
			if(hook.hidden) titleDiv.style.opacity = "0.5";

			if (hook.icon) {
				const iconSpan = titleDiv.createSpan({ cls: "zotero-webhook-icon" });
				setIcon(iconSpan, hook.icon);
			}
			titleDiv.createSpan({ text: hook.name + (hook.hidden ? " (Hidden)" : "") });

			const btnGroup = box.createDiv();
			btnGroup.style.display = 'flex';
			btnGroup.style.gap = '5px';

			new ButtonComponent(btnGroup).setButtonText("Edit").onClick(() => {
				new WebhookEditModal(this.app, hook, async (updated) => {
					this.plugin.settings.webhooks[idx] = updated;
					await this.plugin.saveSettings();
					this.display();
				}).open();
			});

			new ButtonComponent(btnGroup).setIcon("trash").onClick(async () => {
				this.plugin.settings.webhooks.splice(idx, 1);
				await this.plugin.saveSettings();
				this.display();
			});
		});

		new ButtonComponent(container.createDiv({ cls: "zotero-setting-center-btn" }))
			.setButtonText("+ Create Webhook")
			.setCta()
			.onClick(() => {
				const newHook: WebhookProfile = {
					id: Date.now().toString(),
					name: "New Webhook",
					url: "",
					method: "POST",
					icon: "plane",
					headers: [],
					bodyTemplate: '{\n  "filename": "{{filename}}",\n  "content": "{{content}}"\n}',
					hidden: false,
					contentType: 'json',
					inputVariables: []
				};
				new WebhookEditModal(this.app, newHook, async (hook) => {
					this.plugin.settings.webhooks.push(hook);
					await this.plugin.saveSettings();
					this.display();
				}).open();
			});
	}

	// -------------------------------------------------------------------------
	// TAB 4: CFP (Call For Paper)
	// -------------------------------------------------------------------------
	renderCFPSettings(container: HTMLElement) {
		container.createDiv({
			text: "Call For Paper: store CFPs as notes. Add URLs to fetch from WikiCFP, CCFDDL (YAML), EasyChair, or OpenResearch; or use WikiCFP Conf Series (A–Z) as core; or add entries manually.",
			cls: "setting-item-description",
			attr: { style: "margin-bottom: 20px; padding: 12px; background: var(--background-primary-alt); border-radius: 6px; border-left: 3px solid var(--interactive-accent);" }
		});

		// === BASIC SETTINGS CARD ===
		const basicCard = container.createDiv({ cls: 'zotero-setting-card' });
		basicCard.createEl("h3", { text: "Basic Settings", cls: "zotero-card-title" });

		new Setting(basicCard)
			.setName('CFP note folder')
			.setDesc('Folder where CFP notes are stored (one note per acronym).')
			.addText(text => text
				.setValue(this.plugin.settings.cfpNoteDir)
				.onChange(async (value) => {
					this.plugin.settings.cfpNoteDir = value || 'CFP';
					await this.plugin.saveSettings();
				}));

		new Setting(basicCard)
			.setName('Default tags')
			.setDesc('Tags applied to CFP notes (one per line or comma-separated).')
			.addTextArea(text => {
				text.setValue((this.plugin.settings.cfpDefaultTags || []).join(', '))
					.setPlaceholder('cfp, conference')
					.onChange(async (value) => {
						this.plugin.settings.cfpDefaultTags = value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 2;
			});

		new Setting(basicCard)
			.setName('URL sources refresh (days)')
			.setDesc('Refresh from WikiCFP URLs, CCFDDL, EasyChair, OpenResearch every N days (default 5). Set 0 to disable.')
			.addText(text => text
				.setValue(String(this.plugin.settings.cfpRefreshDays ?? 5))
				.onChange(async (value) => {
					const n = parseInt(value, 10);
					this.plugin.settings.cfpRefreshDays = isNaN(n) ? 5 : Math.max(0, n);
					await this.plugin.saveSettings();
				}));

		new Setting(basicCard)
			.setName('Series scan interval (days)')
			.setDesc('Refresh from WikiCFP Conference Series (A–Z) every N days (default 30). Independent from URL sources. Set 0 to disable auto series scan.')
			.addText(text => text
				.setValue(String(this.plugin.settings.cfpSeriesRefreshDays ?? 30))
				.onChange(async (value) => {
					const n = parseInt(value, 10);
					this.plugin.settings.cfpSeriesRefreshDays = isNaN(n) ? 30 : Math.max(0, n);
					await this.plugin.saveSettings();
				}));

		new Setting(basicCard)
			.setName('Conference acronym key (for CFP link)')
			.setDesc('Frontmatter key to read conference acronym for direct CFP match in Assistant (e.g. conference-acronym). If set on a note, exact match is tried first so long titles like "Proceedings of the 16th USENIX Symposium on OSDI" can link by setting this key to "OSDI".')
			.addText(text => text
				.setValue(this.plugin.settings.cfpAcronymKey ?? 'conference-acronym')
				.setPlaceholder('conference-acronym')
				.onChange(async (value) => {
					this.plugin.settings.cfpAcronymKey = (value || 'conference-acronym').trim();
					await this.plugin.saveSettings();
				}));

		// === WIKICFP SERIES CARD ===
		const seriesCard = container.createDiv({ cls: 'zotero-setting-card' });
		seriesCard.createEl("h3", { text: "WikiCFP Conference Series", cls: "zotero-card-title" });
		seriesCard.createDiv({
			text: "Load conference series from WikiCFP's A–Z index. Select specific letters to reduce crawling risk. Auto-refresh uses all configured sources.",
			cls: "setting-item-description",
			attr: { style: "margin-bottom: 16px;" }
		});
		
		// Letters selection area
		const lettersSection = seriesCard.createDiv({ cls: 'zotero-cfp-letters-section' });
		lettersSection.createEl("h4", { text: "Index Letters", cls: "zotero-cfp-filter-title" });
		lettersSection.createDiv({
			text: "Select letters to load (empty = all A-Z):",
			cls: "setting-item-description",
			attr: { style: "margin-bottom: 12px; font-size: 0.85em;" }
		});
		
		const lettersContainer = lettersSection.createDiv({ cls: 'zotero-cfp-letters-container' });
		const allLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
		const selectedLetters = Array.isArray(this.plugin.settings.cfpSeriesIndexLetters)
			? new Set(this.plugin.settings.cfpSeriesIndexLetters)
			: new Set<string>();
		
		// Store checkboxes for select all/deselect all
		const checkboxes: HTMLInputElement[] = [];
		
		allLetters.forEach(letter => {
			const letterItem = lettersContainer.createDiv({ cls: 'zotero-cfp-letter-item' });
			const checkbox = letterItem.createEl('input', { 
				type: 'checkbox', 
				attr: { value: letter, id: `cfp-letter-${letter}` },
				cls: 'zotero-cfp-letter-checkbox'
			}) as HTMLInputElement;
			const label = letterItem.createEl('label', { 
				text: letter,
				attr: { for: `cfp-letter-${letter}` },
				cls: 'zotero-cfp-letter-label'
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
			// Make the whole item clickable (but don't double-trigger checkbox)
			letterItem.onclick = (e) => {
				if (e.target !== checkbox && e.target !== label) {
					checkbox.checked = !checkbox.checked;
					updateSettings();
				}
			};
		});
		
		// Action buttons row
		const actionsRow = seriesCard.createDiv({ cls: 'zotero-cfp-series-actions-row' });
		new ButtonComponent(actionsRow).setButtonText('Select All').onClick(async () => {
			checkboxes.forEach(cb => cb.checked = true);
			this.plugin.settings.cfpSeriesIndexLetters = allLetters.slice();
			await this.plugin.saveSettings();
		});
		new ButtonComponent(actionsRow).setButtonText('Deselect All').onClick(async () => {
			checkboxes.forEach(cb => cb.checked = false);
			this.plugin.settings.cfpSeriesIndexLetters = [];
			await this.plugin.saveSettings();
		});
		new ButtonComponent(actionsRow).setButtonText('Refresh Series').setCta().onClick(() => {
			new Notice('WikiCFP series refresh started. Notices will show progress.');
			this.plugin.cfpService.refreshWikiCFPSeries((msg) => new Notice(msg))
				.then(() => new Notice('WikiCFP series refresh done.'))
				.catch(() => new Notice('WikiCFP series refresh failed. See console.'));
		});

		// === DATAVIEWJS CODE CARD ===
		const codeCard = container.createDiv({ cls: 'zotero-setting-card' });
		codeCard.createEl("h3", { text: "Series Note DataviewJS Code", cls: "zotero-card-title" });
		codeCard.createDiv({
			text: "Custom DataviewJS code for the refresh button in Series notes. Changes apply to all existing Series notes immediately. Available: cur (current page), dv, window.__ZoteroAnnotationReviewerCFP.refreshSeries(programUrl, seriesAcronym).",
			cls: "setting-item-description zotero-desc-tight",
			attr: { style: "margin-bottom: 12px;" }
		});
		const scriptWrapper = codeCard.createDiv({ cls: 'zotero-cfp-script-wrapper' });
		let codeEditor: EditorView | null = null;
		mountCodeMirror(
			scriptWrapper,
			this.plugin.settings.cfpSeriesDataviewJSCode || '',
			'javascript',
			async (val) => {
				this.plugin.settings.cfpSeriesDataviewJSCode = val;
				await this.plugin.saveSettings();
				// Auto-update all existing Series notes
				const updated = await this.plugin.cfpService.updateAllSeriesNotesDataviewJS();
				if (updated > 0) {
					new Notice(`Updated ${updated} Series notes with new code.`);
				}
			},
			{ height: "250px" }
		);
		const updateBtnRow = codeCard.createDiv({ cls: 'zotero-cfp-code-actions-row' });
		new ButtonComponent(updateBtnRow).setButtonText('Update All Series Notes').onClick(async () => {
			new Notice('Updating all Series notes...');
			const updated = await this.plugin.cfpService.updateAllSeriesNotesDataviewJS();
			new Notice(`Updated ${updated} Series notes.`);
		});

		// === URL SOURCES CARD ===
		const urlsCard = container.createDiv({ cls: 'zotero-setting-card' });
		urlsCard.createEl("h3", { text: "URL Sources", cls: "zotero-card-title" });
		urlsCard.createDiv({
			text: "Add URLs from different sources to fetch CFP data. Each source type is managed separately.",
			cls: "setting-item-description",
			attr: { style: "margin-bottom: 16px;" }
		});

		// CFP URL sections wrapper so layout stays stable and all three sections visible
		const cfpUrlsWrapper = urlsCard.createDiv({ cls: 'zotero-cfp-urls-sections' });

		// WikiCFP URLs
		const wikicfpSection = cfpUrlsWrapper.createDiv({ cls: 'zotero-cfp-url-section' });
		const wikicfpHeader = wikicfpSection.createDiv({ cls: 'zotero-cfp-url-section-header' });
		wikicfpHeader.createEl("h4", { text: "WikiCFP URLs", cls: "zotero-cfp-url-section-title" });
		new ButtonComponent(wikicfpHeader).setButtonText('Refresh').setCta().onClick(() => {
			this.plugin.cfpService.refreshWikiCFPUrls();
		});
		wikicfpSection.createDiv({ 
			text: "e.g. http://www.wikicfp.com/cfp/call?conference=machine%20learning", 
			cls: "setting-item-description zotero-cfp-url-desc" 
		});
		const wikicfpAddRow = wikicfpSection.createDiv({ cls: 'zotero-setting-block zotero-cfp-add-row' });
		wikicfpAddRow.style.display = 'flex';
		wikicfpAddRow.style.gap = '8px';
		wikicfpAddRow.style.alignItems = 'center';
		const wikicfpInputWrap = wikicfpAddRow.createDiv();
		wikicfpInputWrap.style.flex = '1';
		wikicfpInputWrap.style.minWidth = '0';
		const wikicfpInput = new TextComponent(wikicfpInputWrap);
		wikicfpInput.setPlaceholder('https://...');
		wikicfpInput.inputEl.addClass('zotero-input-wide');
		wikicfpInput.inputEl.style.width = '100%';
		new ButtonComponent(wikicfpAddRow).setButtonText('Add URL').onClick(async () => {
			const val = wikicfpInput.getValue()?.trim();
			if (!val) return;
			if (!this.plugin.settings.cfpWikicfpUrls) this.plugin.settings.cfpWikicfpUrls = [];
			this.plugin.settings.cfpWikicfpUrls.push(val);
			await this.plugin.saveSettings();
			wikicfpInput.setValue('');
			this.display();
		});
		const wikicfpList = wikicfpSection.createDiv({ cls: 'zotero-settings-list' });
		(this.plugin.settings.cfpWikicfpUrls || []).forEach((url, idx) => {
			const row = wikicfpList.createDiv({ cls: 'zotero-setting-block' });
			row.style.display = 'flex';
			row.style.gap = '8px';
			row.style.alignItems = 'center';
			const urlSpan = row.createSpan({ text: url || '(empty)', cls: 'zotero-cfp-url-display' });
			urlSpan.style.flex = '1';
			new ButtonComponent(row).setIcon('trash').onClick(async () => {
				this.plugin.settings.cfpWikicfpUrls!.splice(idx, 1);
				await this.plugin.saveSettings();
				this.display();
			});
		});

		// CCFDDL URLs (YAML)
		const ccfddlSection = cfpUrlsWrapper.createDiv({ cls: 'zotero-cfp-url-section' });
		const ccfddlHeader = ccfddlSection.createDiv({ cls: 'zotero-cfp-url-section-header' });
		ccfddlHeader.createEl("h4", { text: "CCFDDL URLs (YAML)", cls: "zotero-cfp-url-section-title" });
		new ButtonComponent(ccfddlHeader).setButtonText('Refresh').setCta().onClick(() => {
			this.plugin.cfpService.refreshCcfddlUrls();
		});
		ccfddlSection.createDiv({
			text: "Single YAML URL with all conferences (not per-conference like WikiCFP). e.g. https://ccfddl.com/conference/allconf.yml",
			cls: "setting-item-description zotero-cfp-url-desc"
		});
		const ccfddlAddRow = ccfddlSection.createDiv({ cls: 'zotero-setting-block zotero-cfp-add-row' });
		ccfddlAddRow.style.display = 'flex';
		ccfddlAddRow.style.gap = '8px';
		ccfddlAddRow.style.alignItems = 'center';
		const ccfddlInputWrap = ccfddlAddRow.createDiv();
		ccfddlInputWrap.style.flex = '1';
		ccfddlInputWrap.style.minWidth = '0';
		const ccfddlInput = new TextComponent(ccfddlInputWrap);
		ccfddlInput.setPlaceholder('https://...');
		ccfddlInput.inputEl.addClass('zotero-input-wide');
		ccfddlInput.inputEl.style.width = '100%';
		new ButtonComponent(ccfddlAddRow).setButtonText('Add URL').onClick(async () => {
			const val = ccfddlInput.getValue()?.trim();
			if (!val) return;
			if (!this.plugin.settings.cfpCcfddlUrls) this.plugin.settings.cfpCcfddlUrls = [];
			this.plugin.settings.cfpCcfddlUrls.push(val);
			await this.plugin.saveSettings();
			ccfddlInput.setValue('');
			this.display();
		});
		const ccfddlList = ccfddlSection.createDiv({ cls: 'zotero-settings-list' });
		(this.plugin.settings.cfpCcfddlUrls || []).forEach((url, idx) => {
			const row = ccfddlList.createDiv({ cls: 'zotero-setting-block' });
			row.style.display = 'flex';
			row.style.gap = '8px';
			row.style.alignItems = 'center';
			const urlSpan = row.createSpan({ text: url || '(empty)', cls: 'zotero-cfp-url-display' });
			urlSpan.style.flex = '1';
			new ButtonComponent(row).setIcon('trash').onClick(async () => {
				this.plugin.settings.cfpCcfddlUrls!.splice(idx, 1);
				await this.plugin.saveSettings();
				this.display();
			});
		});

		// EasyChair URLs
		const easychairSection = cfpUrlsWrapper.createDiv({ cls: 'zotero-cfp-url-section' });
		const easychairHeader = easychairSection.createDiv({ cls: 'zotero-cfp-url-section-header' });
		easychairHeader.createEl("h4", { text: "EasyChair URLs", cls: "zotero-cfp-url-section-title" });
		new ButtonComponent(easychairHeader).setButtonText('Refresh').setCta().onClick(() => {
			this.plugin.cfpService.refreshEasychairUrls();
		});
		easychairSection.createDiv({ text: "e.g. https://easychair.org/cfp/area.cgi?area=1", cls: "setting-item-description zotero-cfp-url-desc" });
		const easychairAddRow = easychairSection.createDiv({ cls: 'zotero-setting-block zotero-cfp-add-row' });
		easychairAddRow.style.display = 'flex';
		easychairAddRow.style.gap = '8px';
		easychairAddRow.style.alignItems = 'center';
		const easychairInputWrap = easychairAddRow.createDiv();
		easychairInputWrap.style.flex = '1';
		easychairInputWrap.style.minWidth = '0';
		const easychairInput = new TextComponent(easychairInputWrap);
		easychairInput.setPlaceholder('https://...');
		easychairInput.inputEl.addClass('zotero-input-wide');
		easychairInput.inputEl.style.width = '100%';
		new ButtonComponent(easychairAddRow).setButtonText('Add URL').onClick(async () => {
			const val = easychairInput.getValue()?.trim();
			if (!val) return;
			if (!this.plugin.settings.cfpEasychairUrls) this.plugin.settings.cfpEasychairUrls = [];
			this.plugin.settings.cfpEasychairUrls.push(val);
			await this.plugin.saveSettings();
			easychairInput.setValue('');
			this.display();
		});
		const easychairList = easychairSection.createDiv({ cls: 'zotero-settings-list' });
		(this.plugin.settings.cfpEasychairUrls || []).forEach((url, idx) => {
			const row = easychairList.createDiv({ cls: 'zotero-setting-block' });
			row.style.display = 'flex';
			row.style.gap = '8px';
			row.style.alignItems = 'center';
			const urlSpan = row.createSpan({ text: url || '(empty)', cls: 'zotero-cfp-url-display' });
			urlSpan.style.flex = '1';
			new ButtonComponent(row).setIcon('trash').onClick(async () => {
				this.plugin.settings.cfpEasychairUrls!.splice(idx, 1);
				await this.plugin.saveSettings();
				this.display();
			});
		});

		// OpenResearch URLs
		const openresearchSection = cfpUrlsWrapper.createDiv({ cls: 'zotero-cfp-url-section' });
		const openresearchHeader = openresearchSection.createDiv({ cls: 'zotero-cfp-url-section-header' });
		openresearchHeader.createEl("h4", { text: "OpenResearch URLs", cls: "zotero-cfp-url-section-title" });
		new ButtonComponent(openresearchHeader).setButtonText('Refresh').setCta().onClick(() => {
			this.plugin.cfpService.refreshOpenresearchUrls();
		});
		openresearchSection.createDiv({ text: "e.g. https://www.openresearch.org/mediawiki/index.php?title=Events&field=Science&type=Science", cls: "setting-item-description zotero-cfp-url-desc" });
		const openresearchAddRow = openresearchSection.createDiv({ cls: 'zotero-setting-block zotero-cfp-add-row' });
		openresearchAddRow.style.display = 'flex';
		openresearchAddRow.style.gap = '8px';
		openresearchAddRow.style.alignItems = 'center';
		const openresearchInputWrap = openresearchAddRow.createDiv();
		openresearchInputWrap.style.flex = '1';
		openresearchInputWrap.style.minWidth = '0';
		const openresearchInput = new TextComponent(openresearchInputWrap);
		openresearchInput.setPlaceholder('https://...');
		openresearchInput.inputEl.addClass('zotero-input-wide');
		openresearchInput.inputEl.style.width = '100%';
		new ButtonComponent(openresearchAddRow).setButtonText('Add URL').onClick(async () => {
			const val = openresearchInput.getValue()?.trim();
			if (!val) return;
			if (!this.plugin.settings.cfpOpenresearchUrls) this.plugin.settings.cfpOpenresearchUrls = [];
			this.plugin.settings.cfpOpenresearchUrls.push(val);
			await this.plugin.saveSettings();
			openresearchInput.setValue('');
			this.display();
		});
		const openresearchList = openresearchSection.createDiv({ cls: 'zotero-settings-list' });
		(this.plugin.settings.cfpOpenresearchUrls || []).forEach((url, idx) => {
			const row = openresearchList.createDiv({ cls: 'zotero-setting-block' });
			row.style.display = 'flex';
			row.style.gap = '8px';
			row.style.alignItems = 'center';
			const urlSpan = row.createSpan({ text: url || '(empty)', cls: 'zotero-cfp-url-display' });
			urlSpan.style.flex = '1';
			new ButtonComponent(row).setIcon('trash').onClick(async () => {
				this.plugin.settings.cfpOpenresearchUrls!.splice(idx, 1);
				await this.plugin.saveSettings();
				this.display();
			});
		});

		// === ACTIONS CARD ===
		const actionsCard = container.createDiv({ cls: 'zotero-setting-card' });
		actionsCard.createEl("h3", { text: "Actions", cls: "zotero-card-title" });
		actionsCard.createDiv({
			text: "Manual actions: Add CFP manually or refresh all sources at once. Auto-refresh (based on intervals above) refreshes all sources automatically.",
			cls: "setting-item-description",
			attr: { style: "margin-bottom: 12px;" }
		});
		const btnRow = actionsCard.createDiv({ cls: "zotero-cfp-actions-row" });
		new ButtonComponent(btnRow).setButtonText('Refresh All Sources').setCta().onClick(async () => {
			await this.plugin.cfpService.refresh();
		});
		new ButtonComponent(btnRow).setButtonText('Add Manual CFP').setCta().onClick(() => {
			import('./ui/cfp-manual-modal').then(({ CFPManualModal }) => {
				new CFPManualModal(this.app, this.plugin.settings.cfpDefaultTags || [], (item) => {
					this.plugin.cfpService.saveManualCFP(item)
						.then(() => new Notice('CFP note created.'))
						.catch(() => new Notice('Failed to create CFP note.'));
				}).open();
			});
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

	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement) {
		el.addClass("mod-icon-suggestion");

		const iconName = match.item;

		const iconContainer = el.createDiv({ cls: "suggestion-icon" });
		setIcon(iconContainer, iconName);

		el.createDiv({ text: iconName });
	}

	onChooseItem(icon: string, evt: MouseEvent | KeyboardEvent) {
		this.callback(icon);
	}
}


class WebhookDebugConfirmModal extends Modal {
	onConfirm: () => void | Promise<void>;
	onCancel: () => void;

	constructor(app: App, onConfirm: () => void | Promise<void>, onCancel: () => void) {
		super(app);
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('zotero-webhook-debug-confirm-modal');

		contentEl.createEl('h2', { text: '⚠️ Enable Webhook Debug Mode?' });

		const warning = contentEl.createDiv({ cls: 'zotero-debug-confirm-warning' });
		warning.style.padding = '12px';
		warning.style.marginBottom = '16px';
		warning.style.background = 'var(--background-modifier-error)';
		warning.style.color = 'var(--text-on-accent)';
		warning.style.borderRadius = '6px';
		warning.style.fontWeight = '500';
		warning.createEl('p', { text: 'Debug mode logs full request headers and body to the developer console. This may expose:' });
		const list = warning.createEl('ul');
		list.createEl('li', { text: 'API keys and authentication tokens' });
		list.createEl('li', { text: 'Secret header values' });
		list.createEl('li', { text: 'Sensitive data in the request body' });
		warning.createEl('p', { text: 'Only enable when debugging. Turn it off when done. Do not share console output or screenshots.' });

		const footer = contentEl.createDiv({ cls: 'zotero-debug-confirm-footer' });
		footer.style.display = 'flex';
		footer.style.gap = '8px';
		footer.style.justifyContent = 'flex-end';
		footer.style.marginTop = '16px';

		new ButtonComponent(footer)
			.setButtonText('Cancel')
			.onClick(() => {
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

	onClose() {
		this.contentEl.empty();
	}
}


class WebhookEditModal extends Modal {
	webhook: WebhookProfile;
	onSave: (hook: WebhookProfile) => void;
	// Store editor instance to format it manually if needed
	jsonEditor: EditorView | null = null;

	constructor(app: App, webhook: WebhookProfile, onSave: (hook: WebhookProfile) => void) {
		super(app);
		this.webhook = JSON.parse(JSON.stringify(webhook));
		this.onSave = onSave;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("zotero-modal-wide");

		contentEl.createEl("h2", { text: "Edit Webhook" });

		// 1. Basic Info
		const infoContainer = contentEl.createDiv({ cls: "zotero-setting-group" });
		new Setting(infoContainer).setName("Name").addText(t => t.setValue(this.webhook.name).onChange(v => this.webhook.name = v));

		new Setting(infoContainer)
			.setName("Show in Assistant")
			.setDesc("Toggle visibility in the code block.")
			.addToggle(t => t.setValue(!this.webhook.hidden).onChange(v => this.webhook.hidden = !v));

		// Icon Search
		// [FIXED] Used CSS class instead of inline style
		const iconSetting = new Setting(infoContainer).setName("Icon");
		const iconContainer = iconSetting.controlEl.createDiv({ cls: "zotero-icon-control" });

		// Use the new class for layout (flex, gap, etc.)
		iconContainer.style.display = "flex";
		iconContainer.style.gap = "10px";
		iconContainer.style.alignItems = "center";

		const previewEl = iconContainer.createDiv({ cls: "zotero-icon-preview-box" });
		setIcon(previewEl, this.webhook.icon || "help-circle");

		const iconSearcher = new ButtonComponent(iconContainer)
		iconSearcher.setButtonText(this.webhook.icon || "Select")
			.setIcon("search").onClick(() => {
			new IconSuggestModal(this.app, (selectedIcon) => {
				this.webhook.icon = selectedIcon;
				previewEl.empty();
				setIcon(previewEl, selectedIcon);
			}).open();
		});

		// 2. Request Details
		const reqContainer = contentEl.createDiv({ cls: "zotero-setting-group" });
		new Setting(reqContainer).setName("URL").addText(t => t.setValue(this.webhook.url).onChange(v => this.webhook.url = v).inputEl.addClass("zotero-input-wide"));

		new Setting(reqContainer)
			.setName("Method")
			.addDropdown(d => d.addOption("POST","POST").addOption("GET","GET").addOption("PUT","PUT").setValue(this.webhook.method).onChange(v => this.webhook.method = v as any));

		// 3. Body Content Option
		new Setting(reqContainer)
			.setName("Body Content Type")
			.setDesc("Sets the Content-Type header and body format.")
			.addDropdown(d => d
				.addOption("json", "JSON (application/json)")
				.addOption("text", "Plain Text (text/plain)")
				.addOption("form", "Form (x-www-form-urlencoded)")
				.setValue(this.webhook.contentType || 'json')
				.onChange(v => this.webhook.contentType = v as any));

		// 4. Body Template & Usage Guide
		contentEl.createEl("h4", { text: "Body Template (JSON)" });

		// Ensure inputVariables exists (migrate legacy inputVariable) before usage box
		const legacy = (this.webhook as WebhookProfile & { inputVariable?: WebhookInputVariable }).inputVariable;
		if (legacy && !this.webhook.inputVariables?.length) {
			this.webhook.inputVariables = [legacy];
			delete (this.webhook as { inputVariable?: unknown }).inputVariable;
		}
		if (!this.webhook.inputVariables) this.webhook.inputVariables = [];

		// Usage Box
		const usageBox = contentEl.createDiv({ cls: "zotero-usage-box" });
		usageBox.style.backgroundColor = "var(--background-secondary)";
		usageBox.style.padding = "10px";
		usageBox.style.borderRadius = "5px";
		usageBox.style.marginBottom = "10px";
		usageBox.style.fontSize = "0.9em";
		usageBox.style.color = "var(--text-muted)";

		usageBox.createEl("strong", { text: "ℹ️ Usage Guide: " });
		usageBox.createSpan({ text: "Placeholders: " });
		const inputNames = (this.webhook.inputVariables ?? [])
			.map(iv => iv.name?.trim()).filter(Boolean);
		const inputPlaceholder = inputNames.length
			? " " + inputNames.map(n => `{{${n}}} (from input)`).join(", ") + "."
			: "";
		usageBox.createSpan({ text: "{{content}}, {{filename}}, {{path}}, {{frontmatter.KEY}}." + inputPlaceholder, attr: { style: "color: var(--text-accent);" } });

		// Input variables (inside Body Template section)
		contentEl.createEl("h4", { text: "Input variables", cls: "zotero-input-vars-heading" });
		const inputVarsDesc = contentEl.createDiv({ cls: "setting-item-description", attr: { style: "margin-bottom: 10px;" } });
		inputVarsDesc.setText("Add variables to prompt when triggering. Use {{name}} in the body template above. Each needs a unique name.");
		const inputVarsList = contentEl.createDiv({ cls: "zotero-input-vars-list" });
		const renderInputVars = () => {
			inputVarsList.empty();
			this.webhook.inputVariables!.forEach((iv, idx) => {
				const card = inputVarsList.createDiv({ cls: "zotero-input-var-card" });
				const row = card.createDiv({ cls: "zotero-input-var-row" });
				new TextComponent(row)
					.setPlaceholder("Variable name (e.g. custom)")
					.setValue(iv.name)
					.onChange(v => iv.name = v.trim()).inputEl.addClass("zotero-input-var-name");
				new DropdownComponent(row)
					.addOption("text", "Text")
					.addOption("number", "Number")
					.setValue(iv.type)
					.onChange(v => iv.type = v as 'text' | 'number').selectEl.addClass("zotero-input-var-type");
				new ButtonComponent(row)
					.setIcon("trash-2")
					.setTooltip("Remove")
					.onClick(() => {
						this.webhook.inputVariables!.splice(idx, 1);
						renderInputVars();
					}).buttonEl.addClass("zotero-input-var-remove");
			});
			const addWrap = inputVarsList.createDiv({ cls: "zotero-input-var-add-wrap" });
			new ButtonComponent(addWrap).setButtonText("+ Add input variable").setIcon("plus").setCta().onClick(() => {
				this.webhook.inputVariables!.push({ name: '', type: 'text' });
				renderInputVars();
			}).buttonEl.addClass("zotero-btn-fancy", "zotero-input-var-add-btn");
		};
		renderInputVars();

		// JSON Control Bar
		// [FIXED] Used CSS class instead of inline style
		const jsonControls = contentEl.createDiv({ cls: "zotero-json-controls" });

		new ButtonComponent(jsonControls)
			.setButtonText("Format JSON")
			.setIcon("code-glyph")
			.setTooltip("Prettify JSON")
			.onClick(() => {
				if(!this.jsonEditor) return;
				try {
					const current = this.jsonEditor.state.doc.toString();
					// Only format if there is content
					if (!current.trim()) return;

					const formatted = JSON.stringify(JSON.parse(current), null, 2);

					// Replace entire content
					this.jsonEditor.dispatch({
						changes: {from: 0, to: current.length, insert: formatted}
					});
					new Notice("JSON Formatted!");
				} catch(e) {
					new Notice("Invalid JSON, cannot format.");
				}
			});

		// --- [CodeMirror JSON Editor] ---
		const jsonWrapper = contentEl.createDiv();
		this.jsonEditor = mountCodeMirror(
			jsonWrapper,
			this.webhook.bodyTemplate,
			'json',
			(val) => { this.webhook.bodyTemplate = val; },
			{ height: "250px" }
		);

		// 5. Headers
		contentEl.createEl("h4", { text: "Custom Headers" });
		const headerContainer = contentEl.createDiv();

		let availableSecrets: string[] = [];
		if (this.app.secretStorage && this.app.secretStorage.listSecrets) {
			try { availableSecrets = await this.app.secretStorage.listSecrets(); } catch(e) {}
		}

		const refreshHeaders = () => {
			headerContainer.empty();
			this.webhook.headers.forEach((h, i) => {
				const row = headerContainer.createDiv({ cls: "zotero-setting-block" });
				row.style.marginBottom = "8px";
				row.style.display = "flex";
				row.style.gap = "8px";
				row.style.alignItems = "center";

				new TextComponent(row).setPlaceholder("Key").setValue(h.key).onChange(v => h.key = v).inputEl.style.flex = "1";

				new DropdownComponent(row)
					.addOption('text', 'Text')
					.addOption('secret', 'Secret 🔒')
					.setValue(h.type || 'text')
					.onChange(v => {
						h.type = v as 'text' | 'secret';
						h.value = "";
						refreshHeaders();
					});

				if (h.type === 'secret') {
					const dd = new DropdownComponent(row);
					dd.addOption("", "-- Select Secret --");
					availableSecrets.forEach(s => dd.addOption(s, s));
					dd.setValue(h.value);
					dd.onChange(v => h.value = v);
					if (availableSecrets.length === 0) dd.setDisabled(true);
					dd.selectEl.style.flex = "2";
				} else {
					new TextComponent(row).setPlaceholder("Value").setValue(h.value).onChange(v => h.value = v).inputEl.style.flex = "2";
				}

				new ButtonComponent(row).setIcon("trash").onClick(() => {
					this.webhook.headers.splice(i, 1);
					refreshHeaders();
				});
			});

			new ButtonComponent(headerContainer).setButtonText("+ Add Header").onClick(() => {
				this.webhook.headers.push({ key: "", value: "", type: "text" });
				refreshHeaders();
			});
		};
		refreshHeaders();

		// Footer
		const footer = contentEl.createDiv();
		footer.style.marginTop = "20px";
		footer.style.textAlign = "right";
		new ButtonComponent(footer).setButtonText("Save Webhook").setCta().onClick(() => {
			if (this.webhook.inputVariables)
				this.webhook.inputVariables = this.webhook.inputVariables.filter(iv => iv.name?.trim());
			this.onSave(this.webhook);
			this.close();
		});
	}

	onClose() { this.contentEl.empty(); }
}
