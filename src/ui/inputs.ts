import { App, Modal, Setting } from 'obsidian';

export class InputModal extends Modal {
	result: string;
	onSubmit: (result: string) => void;

	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this.result = "";
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "Enter Citation Key" });

		// 1. 输入框
		const inputSetting = new Setting(contentEl)
			.setName("Citation Key")
			.setDesc("Enter the Better BibTeX Citation Key (e.g. kim2024)")
			.addText((text) =>
				text.onChange((value) => {
					this.result = value;
				})
			);

		// 2. 监听回车键优化体验
		inputSetting.controlEl.querySelector("input")?.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this.submit();
			}
		});

		// 3. 提交按钮
		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Review Highlights")
					.setCta()
					.onClick(() => {
						this.submit();
					})
			);
	}

	submit() {
		if (this.result.trim().length > 0) {
			this.close();
			this.onSubmit(this.result);
		} else {
			// 可选：提示用户输入不能为空
			const inputEl = this.contentEl.querySelector("input");
			if (inputEl) inputEl.style.borderColor = "red";
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
