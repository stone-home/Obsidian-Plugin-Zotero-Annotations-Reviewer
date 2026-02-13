import { MarkdownRenderChild, TFile, ButtonComponent, Notice, App, SuggestModal } from 'obsidian';
import ZoteroGKPlugin from '../main';

export class ProjectSelectorView extends MarkdownRenderChild {
	plugin: ZoteroGKPlugin;

	constructor(containerEl: HTMLElement, plugin: ZoteroGKPlugin) {
		super(containerEl);
		this.plugin = plugin;
	}

	async onload() {
		this.render();
	}

	// Accept optional 'currentProjects' to bypass cache delay
	render(currentProjects?: string[]) {
		this.containerEl.empty();
		const container = this.containerEl.createDiv({ cls: 'project-selector-container' });

		// 1. Get Current Note
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file) {
			container.createDiv({ text: "Please open a note to use the Project Linker." });
			return;
		}

		// 2. Determine Project List (Use override if provided, else Cache)
		let projects: string[] = [];

		if (currentProjects) {
			projects = currentProjects;
		} else {
			const cache = this.plugin.app.metadataCache.getFileCache(file);
			const rawValue = cache?.frontmatter?.[this.plugin.settings.projectFrontmatterKey];

			if (Array.isArray(rawValue)) {
				projects = rawValue;
			} else if (rawValue) {
				projects = [rawValue];
			}
		}

		// 3. Display Projects
		const statusDiv = container.createDiv({ cls: 'project-status' });
		statusDiv.style.marginBottom = "10px";
		statusDiv.style.display = "flex";
		statusDiv.style.flexWrap = "wrap";
		statusDiv.style.gap = "8px";

		statusDiv.createSpan({
			text: "Linked Projects: ",
			attr: { style: "font-weight: bold; margin-right: 5px;" }
		});

		if (projects.length > 0) {
			projects.forEach(proj => {
				const tagParams = {
					cls: "internal-link", // Obsidian class for links
					attr: {
						style: "display: inline-flex; align-items: center; gap: 5px; background-color: var(--background-primary); border: 1px solid var(--background-modifier-border); padding: 2px 8px; border-radius: 12px; text-decoration: none; color: var(--text-accent);"
					}
				};

				const pill = statusDiv.createSpan(tagParams);

				// --- CLICKABLE LINK ---
				const link = pill.createEl("a", {
					text: proj.replace(/[\[\]]/g, "").split("|").pop(),
					attr: {
						href: "#",
						style: "color: inherit; text-decoration: none;"
					}
				});

				// Handle navigation
				link.onclick = (e) => {
					e.preventDefault();
					const inner = proj.replace(/^\[\[|\]\]$/g, "");
					const linkPath = inner.split("|")[0];
					this.plugin.app.workspace.openLinkText(linkPath, file.path);
				};

				// --- REMOVE BUTTON ---
				const removeBtn = pill.createSpan({
					cls: "project-remove-btn",
					attr: {
						title: "Remove project",
						style: "cursor: pointer; color: var(--text-muted); margin-left: 4px; font-weight: bold;"
					}
				});
				removeBtn.innerText = "×";
				removeBtn.onclick = async (e) => {
					e.stopPropagation(); // Prevent triggering the link
					await this.removeProject(file, proj);
				};
			});
		} else {
			statusDiv.createSpan({
				text: "None",
				attr: { style: "color: var(--text-muted); font-style: italic;" }
			});
		}

		// 4. Action Button
		const btnContainer = container.createDiv();
		const btn = new ButtonComponent(btnContainer)
			.setButtonText("Add Project")
			.setIcon("plus")
			.onClick(() => {
				new ProjectSuggestModal(this.plugin.app, this.plugin.settings.projectsFolder, async (selectedFile) => {
					await this.addProject(file, selectedFile);
				}).open();
			});

		btn.buttonEl.addClass("zotero-btn-fancy");
	}

	async addProject(file: TFile, projectFile: TFile) {
		let newList: string[] = [];
		try {
			const projectCache = this.plugin.app.metadataCache.getFileCache(projectFile);
			const targetPropertyKey = this.plugin.settings.projectIdKey; // e.g., "uuid", "alias", "project_code"
			const pathWithoutExt = projectFile.path.replace(/\.[^/.]+$/, "");
			let linkValue = `[[${pathWithoutExt}]]`; // Default fallback
			if (projectCache?.frontmatter && projectCache.frontmatter[targetPropertyKey]) {
				const propValue = projectCache.frontmatter[targetPropertyKey];
				linkValue = `[[${pathWithoutExt}|${propValue}]]`
			}
			await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
				const key = this.plugin.settings.projectFrontmatterKey;
				let current = frontmatter[key];

				if (!current) current = [];
				else if (!Array.isArray(current)) current = [current];
				if (!current.includes(linkValue)) {
					current.push(linkValue);
					frontmatter[key] = current;
					new Notice(`Added project: ${projectFile.basename}`);
				} else {
					new Notice("Project already linked.");
				}
				newList = [...current]; // Capture for immediate render
			});
			// Force render with new list
			this.render(newList);
		} catch (e) {
			new Notice("Failed to update frontmatter: " + e);
		}
	}

	async removeProject(file: TFile, projectName: string) {
		let newList: string[] = [];
		try {
			await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
				const key = this.plugin.settings.projectFrontmatterKey;
				if (Array.isArray(frontmatter[key])) {
					frontmatter[key] = frontmatter[key].filter((p: string) => p !== projectName);
					newList = [...frontmatter[key]]; // Capture for immediate render
					new Notice(`Removed project: ${projectName}`);
				}
			});
			// Force render with new list
			this.render(newList);
		} catch (e) {
			new Notice("Failed to remove project: " + e);
		}
	}
}

class ProjectSuggestModal extends SuggestModal<TFile> {
	projectFolder: string;
	onChoose: (file: TFile) => void;

	constructor(app: App, folderPath: string, onChoose: (file: TFile) => void) {
		super(app);
		this.projectFolder = folderPath;
		this.onChoose = onChoose;
		this.setPlaceholder("Select a project to add...");
	}

	/** Only include files at <projectFolder>/<projectDir>/Dashboard.md (one level down). */
	isProjectDashboard(file: TFile): boolean {
		const base = this.projectFolder.replace(/\/$/, "") + "/";
		if (!file.path.startsWith(base)) return false;
		if (file.extension !== "md" || file.basename !== "Dashboard") return false;
		const rest = file.path.slice(base.length);
		const parts = rest.split("/");
		return parts.length === 2 && parts[1] === "Dashboard.md";
	}

	getDisplayName(file: TFile): string {
		const cache = this.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		const fromFm = (fm?.["project_name"] ?? fm?.["title"])?.toString?.()?.trim();
		if (fromFm) return fromFm;
		const parts = file.path.split("/");
		return parts.length >= 2 ? parts[parts.length - 2] : file.basename;
	}

	getSuggestions(query: string): TFile[] {
		const q = query.toLowerCase();
		const files = this.app.vault.getFiles();
		const dashboards = files.filter(file => this.isProjectDashboard(file));
		return dashboards.filter(file => {
			const displayName = this.getDisplayName(file);
			return displayName.toLowerCase().includes(q) || file.path.toLowerCase().includes(q);
		});
	}

	renderSuggestion(file: TFile, el: HTMLElement) {
		el.createDiv({ text: this.getDisplayName(file) });
	}

	onChooseSuggestion(file: TFile, evt: MouseEvent | KeyboardEvent) {
		this.onChoose(file);
	}
}
