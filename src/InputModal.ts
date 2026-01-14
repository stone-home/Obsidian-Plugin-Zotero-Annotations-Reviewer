import { App, Modal, Setting } from 'obsidian';

export class InputModal extends Modal {
	result!: string;
	onSubmit: (result: string) => void;

	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;

		contentEl.createEl("h2", { text: "Enter Zotero Item Key" });

		let key = "";

		new Setting(contentEl)
			.setName("Citation Key")
			.setDesc("Enter the 8-character Zotero Item Key (e.g., A1B2C3D4)")
			.addText((text) =>
				text.onChange((value) => {
					key = value;
				})
			);

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Fetch Highlights")
					.setCta()
					.onClick(() => {
						this.close();
						this.onSubmit(key);
					})
			);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
