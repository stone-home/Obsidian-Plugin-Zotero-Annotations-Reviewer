import { App, PluginSettingTab, Setting, ButtonComponent, TextComponent, ToggleComponent, TextAreaComponent, DropdownComponent, Notice } from 'obsidian';
import ZoteroGKPlugin from './main';
import { DEFAULT_SETTINGS, MetadataMapInfo, WebhookHeader, WebhookCondition } from './types';

export class ZoteroSettingTab extends PluginSettingTab {
	plugin: ZoteroGKPlugin;
	activeTab: 'general' | 'zotero' | 'webhook' = 'general';

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
		this.renderTabItem(tabsEl, 'webhook', 'Webhook Integration');

		// --- 2. Tab Content ---
		const bodyEl = containerEl.createDiv({ cls: 'zotero-setting-container' });

		if (this.activeTab === 'general') this.renderGeneralSettings(bodyEl);
		else if (this.activeTab === 'zotero') this.renderZoteroSettings(bodyEl);
		else if (this.activeTab === 'webhook') this.renderWebhookSettings(bodyEl);
	}

	renderTabItem(container: HTMLElement, id: 'general' | 'zotero' | 'webhook', label: string) {
		const tab = container.createDiv({ cls: `zotero-tab-item ${this.activeTab === id ? 'active' : ''}` });
		tab.innerText = label;
		tab.onclick = () => {
			this.activeTab = id;
			this.display(); // Re-render
		};
	}

	// =========================================================================
	// TAB 1: GENERAL
	// =========================================================================
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
			.setName("Reset All Settings")
			.setDesc("Restore default configuration.")
			.addButton(btn => btn
				.setButtonText("Restore Defaults")
				.setWarning()
				.onClick(async () => {
					if(confirm("Are you sure you want to reset all settings?")) {
						this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
						await this.plugin.saveSettings();
						this.display();
					}
				}));
	}

	// =========================================================================
	// TAB 2: ZOTERO & HIGHLIGHTS
	// =========================================================================
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
		const metaCard = container.createDiv({ cls: 'zotero-setting-card' });
		metaCard.createDiv({ cls: 'zotero-card-title', text: "Metadata Verification" });
		metaCard.createDiv({ text: "Map Zotero properties to Obsidian frontmatter.", cls: "setting-item-description zotero-setting-spacer-bottom" });

		const metaList = metaCard.createDiv({ cls: 'zotero-settings-list' });
		this.plugin.settings.metadataMapping.forEach((item, index) => {
			this.renderMetadataBlock(metaList, item, index);
		});

		new ButtonComponent(metaCard.createDiv({ cls: "zotero-setting-center-btn" }))
			.setButtonText("+ Add Property")
			.onClick(async () => {
				this.plugin.settings.metadataMapping.push({ label: "New", zoteroProp: "", noteProp: "", enabled: true });
				await this.plugin.saveSettings();
				this.display();
			});

		// Script Card
		const scriptCard = container.createDiv({ cls: 'zotero-setting-card' });
		scriptCard.createDiv({ cls: 'zotero-card-title', text: "Assistant Custom JS" });

		new TextAreaComponent(scriptCard.createDiv())
			.setValue(this.plugin.settings.assistantScript)
			.setPlaceholder('// Custom JS... params: container, file, app')
			.onChange(async (value) => {
				this.plugin.settings.assistantScript = value;
				await this.plugin.saveSettings();
			})
			.inputEl.addClass("zotero-settings-code-block", "zotero-input-wide");
	}

	renderMetadataBlock(container: HTMLElement, item: MetadataMapInfo, index: number) {
		const block = container.createDiv({ cls: 'zotero-setting-block' });

		new ToggleComponent(block).setValue(item.enabled).onChange(async v => { item.enabled = v; await this.plugin.saveSettings(); });

		const row = block.createDiv({ cls: 'zotero-input-group' });
		new TextComponent(row).setPlaceholder("Label").setValue(item.label).onChange(async v => { item.label = v; await this.plugin.saveSettings(); });
		new TextComponent(row).setPlaceholder("Zotero Key").setValue(item.zoteroProp).onChange(async v => { item.zoteroProp = v; await this.plugin.saveSettings(); });
		row.createEl("span", { text: "➔", cls: "zotero-arrow" });
		new TextComponent(row).setPlaceholder("YAML Key").setValue(item.noteProp).onChange(async v => { item.noteProp = v; await this.plugin.saveSettings(); });

		const delBtn = new ButtonComponent(block).setIcon("trash").onClick(async () => {
			this.plugin.settings.metadataMapping.splice(index, 1);
			await this.plugin.saveSettings();
			this.display();
		});
		delBtn.buttonEl.addClass("zotero-delete-btn");
	}

	// =========================================================================
	// TAB 3: WEBHOOK
	// =========================================================================
	async renderWebhookSettings(container: HTMLElement) {
		new Setting(container)
			.setName('Webhook URL')
			.addText(text => text
				.setPlaceholder('https://api.example.com/webhook')
				.setValue(this.plugin.settings.webhookUrl)
				.onChange(async (value) => {
					this.plugin.settings.webhookUrl = value;
					await this.plugin.saveSettings();
				})
				.inputEl.addClass("zotero-input-wide"));

		// Headers Card
		const headerCard = container.createDiv({ cls: 'zotero-setting-card' });
		headerCard.createDiv({ cls: 'zotero-card-title', text: "Request Headers" });

		const headerList = headerCard.createDiv({ cls: 'zotero-settings-list' });

		// Fetch Available Secrets
		let availableSecrets: string[] = [];
		try {
			if (this.app.secretStorage && this.app.secretStorage.listSecrets) {
				availableSecrets = this.app.secretStorage.listSecrets();
			}
		} catch (e) { console.error("Could not list secrets", e); }

		this.plugin.settings.webhookHeaders.forEach((header, index) => {
			this.renderHeaderBlock(headerList, header, index, availableSecrets);
		});

		new ButtonComponent(headerCard.createDiv({ cls: "zotero-setting-center-btn" }))
			.setButtonText("+ Add Header")
			.onClick(async () => {
				this.plugin.settings.webhookHeaders.push({ id: Date.now().toString(), name: "", type: "text", value: "" });
				await this.plugin.saveSettings();
				this.display();
			});

		// Conditions Card
		const condCard = container.createDiv({ cls: 'zotero-setting-card' });
		condCard.createDiv({ cls: 'zotero-card-title', text: "Activation Conditions" });

		const condList = condCard.createDiv({ cls: 'zotero-settings-list' });
		this.plugin.settings.webhookConditions.forEach((cond, index) => {
			this.renderConditionBlock(condList, cond, index);
		});

		new ButtonComponent(condCard.createDiv({ cls: "zotero-setting-center-btn" }))
			.setButtonText("+ Add Condition")
			.onClick(async () => {
				this.plugin.settings.webhookConditions.push({ id: Date.now().toString(), logic: 'AND', field: '', operator: 'eq', value: '' });
				await this.plugin.saveSettings();
				this.display();
			});
	}

	renderHeaderBlock(container: HTMLElement, header: WebhookHeader, index: number, secrets: string[]) {
		const block = container.createDiv({ cls: 'zotero-setting-block' });

		// 1. Header Name
		new TextComponent(block)
			.setPlaceholder("Header Name (e.g. Authorization)")
			.setValue(header.name)
			.onChange(async (val) => { header.name = val; await this.plugin.saveSettings(); });

		// 2. Type Selector (Text vs Secret)
		new DropdownComponent(block)
			.addOption('text', 'String')
			.addOption('secret', 'Secret 🔒')
			.setValue(header.type)
			.onChange(async (val) => {
				header.type = val as 'text' | 'secret';
				header.value = ""; // Reset value on type change
				await this.plugin.saveSettings();
				this.display(); // Re-render to swap input
			});

		// 3. Value Input
		if (header.type === 'secret') {
			const dd = new DropdownComponent(block);
			dd.addOption("", "-- Select Secret --");
			secrets.forEach(s => dd.addOption(s, s));
			dd.setValue(header.value);
			dd.onChange(async (val) => {
				header.value = val;
				await this.plugin.saveSettings();
			});
			if (secrets.length === 0) {
				dd.setDisabled(true);
				new ButtonComponent(block).setButtonText("Manage Secrets?").onClick(() => {
					new Notice("Use Obsidian Settings > Community Plugins > ... to manage keychain.");
				});
			}
		} else {
			new TextComponent(block)
				.setPlaceholder("Value")
				.setValue(header.value)
				.onChange(async (val) => { header.value = val; await this.plugin.saveSettings(); });
		}

		new ButtonComponent(block).setIcon("trash").onClick(async () => {
			this.plugin.settings.webhookHeaders.splice(index, 1);
			await this.plugin.saveSettings();
			this.display();
		}).buttonEl.addClass("zotero-delete-btn");
	}

	renderConditionBlock(container: HTMLElement, cond: WebhookCondition, index: number) {
		const block = container.createDiv({ cls: 'zotero-setting-block' });

		if (index > 0) {
			new DropdownComponent(block).addOption('AND', 'AND').addOption('OR', 'OR').setValue(cond.logic)
				.onChange(async v => { cond.logic = v as any; await this.plugin.saveSettings(); });
		} else {
			block.createDiv({ text: "IF", cls: "zotero-condition-label" });
		}

		new TextComponent(block).setPlaceholder("Field (e.g. frontmatter.status)").setValue(cond.field)
			.onChange(async v => { cond.field = v; await this.plugin.saveSettings(); });

		new DropdownComponent(block)
			.addOption('eq', '==')
			.addOption('neq', '!=')
			.addOption('contains', 'Contains')
			.addOption('regex', 'Regex')
			.setValue(cond.operator)
			.onChange(async v => { cond.operator = v as any; await this.plugin.saveSettings(); });

		new TextComponent(block).setPlaceholder("Value").setValue(cond.value)
			.onChange(async v => { cond.value = v; await this.plugin.saveSettings(); });

		new ButtonComponent(block).setIcon("trash").onClick(async () => {
			this.plugin.settings.webhookConditions.splice(index, 1);
			await this.plugin.saveSettings();
			this.display();
		}).buttonEl.addClass("zotero-delete-btn");
	}
}
