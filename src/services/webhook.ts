import { requestUrl, Notice, TFile, App } from 'obsidian';
import { MyPluginSettings } from '../types';

export class WebhookService {
	private settings: MyPluginSettings;
	private app: App;

	constructor(app: App, settings: MyPluginSettings) {
		this.app = app;
		this.settings = settings;
	}

	async checkConditions(file: TFile): Promise<boolean> {
		if (this.settings.webhookConditions.length === 0) return true;

		const cache = this.app.metadataCache.getFileCache(file);
		const frontmatter = cache?.frontmatter || {};
		const content = await this.app.vault.read(file);

		let result = true;

		for (const [index, cond] of this.settings.webhookConditions.entries()) {
			let fieldValue = "";
			if (cond.field === "content") {
				fieldValue = content;
			} else if (cond.field.startsWith("frontmatter.")) {
				const key = cond.field.replace("frontmatter.", "");
				fieldValue = frontmatter[key] ? String(frontmatter[key]) : "";
			} else if (cond.field === "filename") {
				fieldValue = file.name;
			} else {
				fieldValue = frontmatter[cond.field] ? String(frontmatter[cond.field]) : "";
			}

			let match = false;
			switch (cond.operator) {
				case 'eq': match = fieldValue === cond.value; break;
				case 'neq': match = fieldValue !== cond.value; break;
				case 'contains': match = fieldValue.includes(cond.value); break;
				case 'not_contains': match = !fieldValue.includes(cond.value); break;
				case 'regex':
					try {
						match = new RegExp(cond.value).test(fieldValue);
					} catch (e) { console.error(e); match = false; }
					break;
			}

			if (index === 0) result = match;
			else {
				if (cond.logic === 'AND') result = result && match;
				else if (cond.logic === 'OR') result = result || match;
			}
		}
		return result;
	}

	async sendNoteData(file: TFile) {
		if (!this.settings.webhookUrl) {
			new Notice("❌ Webhook URL not configured.");
			return;
		}

		if (!(await this.checkConditions(file))) {
			new Notice("⚠️ Webhook conditions not met.");
			return;
		}

		new Notice("🚀 Sending Webhook...");

		try {
			const cache = this.app.metadataCache.getFileCache(file);
			const payload = {
				filename: file.name,
				path: file.path,
				frontmatter: cache?.frontmatter,
				content: await this.app.vault.read(file),
				timestamp: new Date().toISOString()
			};

			// Build Headers
			const headers: Record<string, string> = {
				'Content-Type': 'application/json'
			};
			console.error(this.settings.webhookHeaders)
			for (const h of this.settings.webhookHeaders) {
				if (h.type === 'secret') {
					if (this.app.secretStorage) {
						const secretVal = this.app.secretStorage.getSecret(h.value);
						if (secretVal) {
							headers[h.name] = secretVal;
						} else {
							console.warn(`Secret key '${h.value}' returned empty or null.`);
						}
					} else {
						console.warn("SecretStorage API is not available on this version of Obsidian.");
					}
				} else {
					headers[h.name] = h.value;
				}
			}

			const response = await requestUrl({
				url: this.settings.webhookUrl,
				method: 'POST',
				headers: headers,
				body: JSON.stringify(payload)
			});

			if (response.status >= 200 && response.status < 300) {
				new Notice("✅ Webhook Sent Successfully!");
			} else {
				new Notice(`⚠️ Webhook Error: ${response.status}`);
			}

		} catch (e) {
			console.error(e);
			new Notice(`❌ Webhook Failed: ${(e as Error).message}`);
		}
	}
}
