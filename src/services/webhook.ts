import { requestUrl, Notice, TFile, App } from 'obsidian';
import { MyPluginSettings } from '../types';

export class WebhookService {
	private settings: MyPluginSettings;
	private app: App;

	constructor(app: App, settings: MyPluginSettings) {
		this.app = app;
		this.settings = settings;
	}

	async sendNoteData(file: TFile) {
		if (!this.settings.webhookUrl) {
			new Notice("❌ Webhook URL not configured in settings.");
			return;
		}

		new Notice("🚀 Sending Webhook...");

		try {
			// 1. Get Frontmatter
			const cache = this.app.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter;

			// 2. Get Content
			const content = await this.app.vault.read(file);

			// 3. Construct Payload
			const payload = {
				filename: file.name,
				path: file.path,
				frontmatter: frontmatter,
				content: content,
				timestamp: new Date().toISOString()
			};

			// 4. Send Request
			const response = await requestUrl({
				url: this.settings.webhookUrl,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(payload)
			});

			if (response.status >= 200 && response.status < 300) {
				new Notice("✅ Webhook Sent Successfully!");
			} else {
				new Notice(`⚠️ Webhook Error: ${response.status}`);
			}

		} catch (e) {
			console.error(e);
			// Fix: Cast 'e' to Error to access .message safely
			new Notice(`❌ Webhook Failed: ${(e as Error).message}`);
		}
	}
}
