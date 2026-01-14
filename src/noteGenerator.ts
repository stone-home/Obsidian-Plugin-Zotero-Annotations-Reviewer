import { App, TFile, normalizePath } from 'obsidian';

export class NoteGenerator {
	app: App;
	settings: any;

	constructor(app: App, settings: any) {
		this.app = app;
		this.settings = settings;
	}

	// 检查是否已导出：通过 Frontmatter 的 zotero-annotation-key
	async checkExistence(annotationKey: string): Promise<TFile | null> {
		const files = this.app.vault.getMarkdownFiles();
		// 性能优化：只搜索 Fleeting Notes 文件夹
		const targetFolder = this.settings.fleetingNoteFolder;

		for (const file of files) {
			if (!file.path.startsWith(targetFolder)) continue;

			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter && cache.frontmatter['zotero-annotation-key'] === annotationKey) {
				return file;
			}
		}
		return null;
	}

	async createOrUpdateNote(highlight: any, mode: "create" | "rewrite" | "append", existingFile?: TFile) {
		const folder = this.settings.fleetingNoteFolder;

		// 确保文件夹存在
		if (!this.app.vault.getAbstractFileByPath(folder)) {
			await this.app.vault.createFolder(folder);
		}

		// 模板内容 (Zettelkasten 风格)
		const bodyContent = `
## Highlight
> [!quote]
> ${highlight.text}

## Thoughts
${highlight.comment}

## Metadata
- **Source**: [Zotero Link](${highlight.link})
- **Page**: ${highlight.pageLabel}
- **Color**: ${highlight.color}
`;

		if (mode === "create") {
			// 命名策略：优先用 Comment，否则用 Key
			let fileName = highlight.comment
				? highlight.comment.slice(0, 30).replace(/[\\/:*?"<>|]/g, "").trim()
				: `Annotation-${highlight.key}`;

			// 避免重名
			let filePath = normalizePath(`${folder}/${fileName}.md`);
			let counter = 1;
			while (this.app.vault.getAbstractFileByPath(filePath)) {
				filePath = normalizePath(`${folder}/${fileName}-${counter}.md`);
				counter++;
			}

			const fileContent = `---
created: ${new Date().toISOString()}
tags: fleeting-note
zotero-annotation-key: ${highlight.key}
---
${bodyContent}`;

			await this.app.vault.create(filePath, fileContent);
		}
		else if (mode === "rewrite" && existingFile) {
			// 保留原有 Frontmatter，只更新内容区
			// 简单起见，这里演示全覆盖（生产环境建议读取旧 Frontmatter）
			const newContent = `---
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
tags: fleeting-note
zotero-annotation-key: ${highlight.key}
---
${bodyContent}`;
			await this.app.vault.modify(existingFile, newContent);
		}
		else if (mode === "append" && existingFile) {
			const appendText = `\n\n---\n### Update (${new Date().toLocaleDateString()})\n${highlight.comment}`;
			await this.app.vault.append(existingFile, appendText);
		}
	}
}
