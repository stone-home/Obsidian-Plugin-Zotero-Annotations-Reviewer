import { requestUrl, Notice, TFile, App } from 'obsidian';
import { WebhookProfile } from '../types';

export class WebhookService {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	async triggerWebhook(profile: WebhookProfile, file: TFile) {
		if (!profile.url) {
			new Notice(`❌ Webhook "${profile.name}" has no URL.`);
			return;
		}

		new Notice(`🚀 Triggering: ${profile.name}...`);

		try {
			// 1. Context: Active Note (TFile)
			const cache = this.app.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter || {};
			const content = await this.app.vault.read(file);

			// 2. Variables
			const variables: Record<string, string> = {
				'{{filename}}': file.name,
				'{{path}}': file.path,
				'{{content}}': content,
				'{{timestamp}}': new Date().toISOString()
			};

			Object.keys(frontmatter).forEach(key => {
				variables[`{{frontmatter.${key}}}`] = String(frontmatter[key]);
			});

			// 3. Body Replacement
			let body = profile.bodyTemplate || "";
			if (profile.method !== 'GET' && body.trim().length > 0) {
				for (const [key, val] of Object.entries(variables)) {
					const safeVal = val.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
					body = body.split(key).join(safeVal);
				}
			}

			// 4. Headers & Content-Type
			const headers: Record<string, string> = {};

			// Auto-set Content-Type based on setting
			if (profile.contentType === 'json') headers['Content-Type'] = 'application/json';
			else if (profile.contentType === 'form') headers['Content-Type'] = 'application/x-www-form-urlencoded';
			else if (profile.contentType === 'text') headers['Content-Type'] = 'text/plain';

			// Mix in custom headers (overrides if key exists)
			for (const h of profile.headers) {
				let finalValue = h.value;

				if (h.type === 'secret') {
					if (this.app.secretStorage) {
						const secret = this.app.secretStorage.getSecret(h.value);
						if (secret) finalValue = secret;
					}
				}
				// Template headers
				for (const [vKey, vVal] of Object.entries(variables)) {
					finalValue = finalValue.split(vKey).join(vVal);
				}
				headers[h.key] = finalValue;
			}

			// 5. Send
			const response = await requestUrl({
				url: profile.url,
				method: profile.method,
				headers: headers,
				body: profile.method !== 'GET' ? body : undefined
			});

			if (response.status >= 200 && response.status < 300) {
				new Notice(`✅ ${profile.name} Sent!`);
			} else {
				new Notice(`⚠️ ${profile.name} Failed: ${response.status}`);
			}

		} catch (e) {
			console.error(e);
			new Notice(`❌ Webhook Error: ${(e as Error).message}`);
		}
	}
}
