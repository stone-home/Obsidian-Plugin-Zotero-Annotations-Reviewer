import { App, PluginSettingTab, Setting, ButtonComponent, TextComponent, ToggleComponent, TextAreaComponent } from 'obsidian';
import ZoteroGKPlugin from './main';
import { DEFAULT_SETTINGS, MetadataMapInfo } from './types';

export class ZoteroSettingTab extends PluginSettingTab {
	plugin: ZoteroGKPlugin;

	constructor(app: App, plugin: ZoteroGKPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// --- 1. General Settings ---
		new Setting(containerEl).setName('General').setHeading();

		new Setting(containerEl)
			.setName('Zotero Port')
			.setDesc('Port for Better BibTeX JSON-RPC (Default: 23119)')
			.addText(text => text
				.setValue(String(this.plugin.settings.zoteroPort))
				.onChange(async (value) => {
					this.plugin.settings.zoteroPort = Number(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Fleeting Notes Folder')
			.setDesc('Folder where atomic notes will be created')
			.addText(text => text
				.setValue(this.plugin.settings.fleetingNoteFolder)
				.onChange(async (value) => {
					this.plugin.settings.fleetingNoteFolder = value;
					await this.plugin.saveSettings();
				}));

		// --- NEW: SORTING SETTING ---
		new Setting(containerEl)
			.setName('Default Annotation Sort')
			.setDesc('Property to sort highlights by in the review modal.')
			.addDropdown(dropdown => dropdown
				.addOption('color', 'Color (Group by Color)')
				.addOption('pageLabel', 'Page Number')
				.addOption('type', 'Annotation Type (Highlight/Image)')
				.addOption('text', 'Content Text')
				.setValue(this.plugin.settings.sortProperty)
				.onChange(async (value) => {
					this.plugin.settings.sortProperty = value;
					await this.plugin.saveSettings();
				}));

		// --- 2. Metadata Verification (Blocks) ---
		containerEl.createEl("h3", { text: "Metadata Verification Properties" });
		containerEl.createDiv({
			text: "Define which properties to verify between Zotero and your Obsidian Note.",
			cls: "setting-item-description zotero-setting-spacer-bottom"
		});

		const metaListContainer = containerEl.createDiv({ cls: 'zotero-settings-list' });

		this.plugin.settings.metadataMapping.forEach((mapItem, index) => {
			this.renderMetadataBlock(metaListContainer, mapItem, index);
		});

		const btnDiv = containerEl.createDiv({ cls: "zotero-setting-center-btn" });
		new ButtonComponent(btnDiv)
			.setButtonText("+ Add New Property")
			.onClick(async () => {
				this.plugin.settings.metadataMapping.push({
					label: "New Property",
					zoteroProp: "",
					noteProp: "",
					enabled: true
				});
				await this.plugin.saveSettings();
				this.display();
			});

		// --- 3. Assistant JS Script ---
		containerEl.createEl("hr");
		const scriptHeader = containerEl.createDiv({ cls: 'zotero-script-header' });

		scriptHeader.createEl("h3", { text: "Assistant View Customization (JS)", cls: "zotero-no-margin-bottom" });
		scriptHeader.createDiv({
			text: "Custom JavaScript to render the 'Local Highlights' section. Params: container, file, app.",
			cls: "setting-item-description zotero-setting-spacer-bottom"
		});

		const scriptContainer = containerEl.createDiv({ cls: 'zotero-script-container' });
		const scriptArea = new TextAreaComponent(scriptContainer);
		scriptArea
			.setValue(this.plugin.settings.assistantScript)
			.setPlaceholder('// Example:\n// const content = await app.vault.read(file);\n// container.createDiv({text: content.slice(0,50)});\n')
			.onChange(async (value) => {
				this.plugin.settings.assistantScript = value;
				await this.plugin.saveSettings();
			});

		scriptArea.inputEl.addClass("zotero-settings-code-block");

		new Setting(containerEl)
			.setName("Reset Settings")
			.setDesc("Restore metadata mapping and script to defaults.")
			.addButton(btn => btn
				.setButtonText("Restore Defaults")
				.setWarning()
				.onClick(async () => {
					this.plugin.settings.metadataMapping = DEFAULT_SETTINGS.metadataMapping;
					this.plugin.settings.assistantScript = "";
					this.plugin.settings.sortProperty = "color";
					await this.plugin.saveSettings();
					this.display();
				}));

		// --- 4. Webhook ---
		new Setting(containerEl).setName('Webhook Integration').setHeading();
		new Setting(containerEl)
			.setName('Webhook URL')
			.addText(text => text
				.setValue(this.plugin.settings.webhookUrl)
				.onChange(async (value) => {
					this.plugin.settings.webhookUrl = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Enable Condition (Regex)')
			.addText(text => text
				.setValue(this.plugin.settings.webhookCondition)
				.onChange(async (value) => {
					this.plugin.settings.webhookCondition = value;
					await this.plugin.saveSettings();
				}));
	}

	renderMetadataBlock(container: HTMLElement, item: MetadataMapInfo, index: number) {
		const block = container.createDiv({ cls: 'zotero-setting-block' });
		const row1 = block.createDiv({ cls: 'zotero-block-row header' });

		const toggle = new ToggleComponent(row1);
		toggle.setValue(item.enabled).onChange(async (val) => {
			item.enabled = val;
			await this.plugin.saveSettings();
		});
		toggle.toggleEl.style.marginRight = "10px";

		const labelInput = new TextComponent(row1);
		labelInput.setPlaceholder("Display Label")
			.setValue(item.label)
			.onChange(async (val) => {
				item.label = val;
				await this.plugin.saveSettings();
			});
		labelInput.inputEl.addClass("zotero-setting-input-bold");
		labelInput.inputEl.style.flex = "1";

		const delBtn = new ButtonComponent(row1);
		delBtn.setIcon("trash")
			.setTooltip("Remove Property")
			.onClick(async () => {
				this.plugin.settings.metadataMapping.splice(index, 1);
				await this.plugin.saveSettings();
				this.display();
			});
		delBtn.buttonEl.addClass("zotero-delete-btn");

		const row2 = block.createDiv({ cls: 'zotero-block-row fields' });
		const zDiv = row2.createDiv({ cls: 'zotero-field-group' });
		zDiv.createEl("span", { text: "Zotero Key:" });
		new TextComponent(zDiv)
			.setPlaceholder("e.g. date")
			.setValue(item.zoteroProp)
			.onChange(async (val) => {
				item.zoteroProp = val;
				await this.plugin.saveSettings();
			});

		row2.createEl("span", { text: "➔", cls: "zotero-arrow" });

		const nDiv = row2.createDiv({ cls: 'zotero-field-group' });
		nDiv.createEl("span", { text: "Note YAML:" });
		new TextComponent(nDiv)
			.setPlaceholder("e.g. year")
			.setValue(item.noteProp)
			.onChange(async (val) => {
				item.noteProp = val;
				await this.plugin.saveSettings();
			});
	}
}
