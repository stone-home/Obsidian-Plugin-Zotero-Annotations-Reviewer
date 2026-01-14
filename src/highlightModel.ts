import { App, Modal, Notice, Setting, TFile } from 'obsidian';
import { ZoteroClient } from './zoteroClient';
import { NoteGenerator } from './noteGenerator';

export class HighlightModal extends Modal {
	citationKey: string;
	client: ZoteroClient;
	generator: NoteGenerator;
	settings: any;
	highlights: any[] = [];

	constructor(app: App, settings: any, citationKey: string) {
		super(app);
		this.citationKey = citationKey;
		this.settings = settings;
		this.client = new ZoteroClient(settings.zoteroPort);
		this.generator = new NoteGenerator(app, settings);
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: `Highlights: ${this.citationKey}` });

		const loadingEl = contentEl.createDiv({ text: "Connecting to Zotero..." });

		try {
			this.highlights = await this.client.getHighlights(this.citationKey);
			loadingEl.remove();

			if (this.highlights.length === 0) {
				contentEl.createEl("p", { text: "No highlights found for this item." });
			} else {
				this.renderHighlights();
			}
		} catch (e) {
			loadingEl.setText(`Error: ${(e as Error).message}`);
			loadingEl.style.color = "var(--text-error)";
		}
	}

	async renderHighlights() {
		const { contentEl } = this;
		const listContainer = contentEl.createDiv({ cls: 'zotero-highlight-list' });

		for (const h of this.highlights) {
			const card = listContainer.createDiv({ cls: 'highlight-card' });

			// 颜色条
			card.style.borderLeft = `4px solid ${h.color}`;
			card.style.backgroundColor = "var(--background-secondary)";
			card.style.padding = "10px";
			card.style.marginBottom = "10px";
			card.style.borderRadius = "4px";

			// 引用内容
			const quoteEl = card.createEl("blockquote", { text: h.text });
			quoteEl.style.margin = "0 0 10px 0";

			// 评论/笔记
			if (h.comment) {
				card.createEl("div", {
					text: `💡 ${h.comment}`,
					style: "font-weight:bold; margin-bottom:8px; color:var(--text-accent);"
				});
			}

			// 底部元数据
			const metaDiv = card.createDiv({ style: "display:flex; justify-content:space-between; align-items:center; font-size:0.8em; color:var(--text-muted);" });
			metaDiv.createSpan({ text: `Page: ${h.pageLabel}` });

			// 状态管理
			const existingFile = await this.generator.checkExistence(h.key);

			const actionsDiv = card.createDiv({ cls: 'actions-row' });
			actionsDiv.style.display = "flex";
			actionsDiv.style.gap = "10px";
			actionsDiv.style.marginTop = "10px";

			if (existingFile) {
				// 已存在 -> 提供更新选项
				const btnUpdate = actionsDiv.createEl("button", { text: "Append" });
				btnUpdate.onclick = async () => {
					await this.generator.createOrUpdateNote(h, "append", existingFile);
					new Notice("Appended to note.");
				};

				const btnRewrite = actionsDiv.createEl("button", { text: "Rewrite" });
				btnRewrite.onclick = async () => {
					await this.generator.createOrUpdateNote(h, "rewrite", existingFile);
					new Notice("Note rewritten.");
				};

				metaDiv.createSpan({ text: "✅ Exported", style: "color:var(--text-success)" });
			} else {
				// 新建 -> Create
				const btnCreate = actionsDiv.createEl("button", { text: "Create Note", cls: "mod-cta" });
				btnCreate.onclick = async () => {
					await this.generator.createOrUpdateNote(h, "create");
					new Notice("Fleeting note created.");
					this.renderHighlights(); // 刷新状态
				};
			}
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}
