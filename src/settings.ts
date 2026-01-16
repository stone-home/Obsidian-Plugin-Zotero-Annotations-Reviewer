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
	setIcon
} from 'obsidian';
import ZoteroGKPlugin from './main';
import { WebhookProfile } from './types';

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
		this.renderTabItem(tabsEl, 'webhook', 'Modular Webhooks');

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
		new TextAreaComponent(container.createDiv())
			.setValue(this.plugin.settings.assistantScript)
			.setPlaceholder('// Custom JS... params: container, file, app')
			.onChange(async (value) => {
				this.plugin.settings.assistantScript = value;
				await this.plugin.saveSettings();
			})
			.inputEl.addClass("zotero-settings-code-block", "zotero-input-wide");
	}

	// =========================================================================
	// TAB 3: MODULAR WEBHOOKS
	// =========================================================================
	renderWebhookSettings(container: HTMLElement) {
		container.createDiv({
			text: "Configure modular webhooks. Toggle 'Show in Assistant' to display them on the note.",
			cls: "setting-item-description"
		});

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
					contentType: 'json'
				};
				new WebhookEditModal(this.app, newHook, async (hook) => {
					this.plugin.settings.webhooks.push(hook);
					await this.plugin.saveSettings();
					this.display();
				}).open();
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
		return getIconIds(); // This requires the import above
	}

	getItemText(icon: string): string {
		return icon;
	}

	// 2. USE FuzzyMatch<string> here, not just string
	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement) {
		el.addClass("mod-icon-suggestion");

		const iconName = match.item; // Extract the string from the match object

		const iconContainer = el.createDiv({ cls: "suggestion-icon" });
		setIcon(iconContainer, iconName);

		el.createDiv({ text: iconName });
	}

	onChooseItem(icon: string, evt: MouseEvent | KeyboardEvent) {
		this.callback(icon);
	}
}


class WebhookEditModal extends Modal {
	webhook: WebhookProfile;
	onSave: (hook: WebhookProfile) => void;

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
		const iconSetting = new Setting(infoContainer).setName("Icon");
		const iconContainer = iconSetting.controlEl.createDiv({ cls: "zotero-icon-control" });
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
		contentEl.createEl("h4", { text: "Body Template" });

		// Usage Box
		const usageBox = contentEl.createDiv({ cls: "zotero-usage-box" });
		usageBox.style.backgroundColor = "var(--background-secondary)";
		usageBox.style.padding = "10px";
		usageBox.style.borderRadius = "5px";
		usageBox.style.marginBottom = "10px";
		usageBox.style.fontSize = "0.9em";
		usageBox.style.color = "var(--text-muted)";

		usageBox.createEl("strong", { text: "ℹ️ Usage Guide: " });
		usageBox.createSpan({ text: "The input context is the " });

		// FIX: Use `attr` for style, or set .style property directly
		const strong = usageBox.createEl("strong", { text: "Active Note (TFile)" });
		strong.style.color = "var(--text-accent)";

		usageBox.createSpan({ text: ". You can use these placeholders:" });

		const ul = usageBox.createEl("ul", { attr: { style: "margin: 5px 0 0 20px;" } });
		ul.createEl("li", { text: "{{content}} - Full file content" });
		ul.createEl("li", { text: "{{filename}} - Note name (e.g. MyNote.md)" });
		ul.createEl("li", { text: "{{path}} - Vault path" });
		ul.createEl("li", { text: "{{frontmatter.KEY}} - Any frontmatter property (e.g. {{frontmatter.title}})" });

		// Text Area
		const bodyTa = new TextAreaComponent(contentEl)
			.setValue(this.webhook.bodyTemplate)
			.setPlaceholder('{\n  "note": "{{content}}"\n}')
			.onChange(v => this.webhook.bodyTemplate = v);

		bodyTa.inputEl.rows = 12;
		bodyTa.inputEl.addClass("zotero-input-wide", "zotero-settings-code-block");

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
			this.onSave(this.webhook);
			this.close();
		});
	}

	onClose() { this.contentEl.empty(); }
}
