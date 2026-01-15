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
			// 1. Gather Data (TFile Access)
			const cache = this.app.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter || {};
			const content = await this.app.vault.read(file);

			// 2. Prepare Variables
			const variables: Record<string, string> = {
				'{{filename}}': file.name,
				'{{path}}': file.path,
				'{{content}}': content,
				'{{timestamp}}': new Date().toISOString()
			};

			// Flatten frontmatter for easier access
			Object.keys(frontmatter).forEach(key => {
				const val = frontmatter[key];
				// Support {{frontmatter.key}}
				variables[`{{frontmatter.${key}}}`] = String(val);
				// Also support simple {{key}} if no conflict, though specific is safer
			});

			// 3. Process Body Template
			let body = profile.bodyTemplate || "";
			if (profile.method !== 'GET' && body.trim().length > 0) {
				for (const [key, val] of Object.entries(variables)) {
					// Safe JSON escape for content
					const safeVal = val.replace(/\\/g, '\\\\')
						.replace(/\n/g, '\\n')
						.replace(/"/g, '\\"')
						.replace(/\r/g, '\\r')
						.replace(/\t/g, '\\t');

					// Replace all occurrences
					body = body.split(key).join(safeVal);
				}
			}

			// 4. Process Headers (Secret Support)
			const headers: Record<string, string> = {};

			// Auto Content-Type if JSON
			if (body.trim().startsWith('{')) {
				headers['Content-Type'] = 'application/json';
			}

			for (const h of profile.headers) {
				let finalValue = h.value;

				// SECRET HANDLING
				if (h.type === 'secret') {
					if (this.app.secretStorage) {
						// h.value holds the KEY of the secret (e.g. "openai_api_key")
						const secret = await this.app.secretStorage.getSecret(h.value);
						if (secret) {
							finalValue = secret;
						} else {
							console.warn(`Secret '${h.value}' not found or empty.`);
							finalValue = ""; // Or keep key? Better empty to avoid leaking key name.
						}
					} else {
						console.warn("SecretStorage not supported.");
					}
				}

				// Apply templating to headers too (e.g. {{filename}} in header)
				for (const [vKey, vVal] of Object.entries(variables)) {
					finalValue = finalValue.split(vKey).join(vVal);
				}

				headers[h.key] = finalValue;
			}

			// 5. Send Request
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
				console.warn(response.text);
			}

		} catch (e) {
			console.error(e);
			new Notice(`❌ Webhook Error: ${(e as Error).message}`);
		}
	}
}
