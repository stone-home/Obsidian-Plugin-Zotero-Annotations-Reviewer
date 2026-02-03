import { requestUrl, Notice, TFile, App } from 'obsidian';
import { WebhookProfile } from '../types';

export class WebhookService {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	async triggerWebhook(profile: WebhookProfile, file: TFile, extraVariables?: Record<string, string>) {
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

			// 2. Variables Preparation
			const variables: Record<string, string> = {
				'{{filename}}': file.name,
				'{{path}}': file.path,
				'{{content}}': content,
				'{{timestamp}}': new Date().toISOString()
			};
			if (extraVariables) {
				for (const [key, val] of Object.entries(extraVariables)) {
					variables[`{{${key}}}`] = String(val);
				}
			}

			Object.keys(frontmatter).forEach(key => {
				// Ensure frontmatter values are strings for replacement
				variables[`{{frontmatter.${key}}}`] = String(frontmatter[key]);
			});

			// 3. Body Construction (The Safer Way)
			let body: string | undefined = undefined;

			if (profile.method !== 'GET') {
				const rawTemplate = profile.bodyTemplate || "";

				// STRATEGY: JSON Object Manipulation (Best Practice)
				if (profile.contentType === 'json' && rawTemplate.trim().length > 0) {
					try {
						// A. Parse Template -> Object
						const templateObj = JSON.parse(rawTemplate);

						// B. Recursively Fill Values (No manual escaping needed!)
						const filledObj = this.fillTemplateRecursive(templateObj, variables);

						// C. Stringify back to JSON
						body = JSON.stringify(filledObj);

					} catch (e) {
						console.warn("Webhook template is not valid JSON, falling back to raw string replacement.", e);
						// Fallback: Use string replacement if user's template is invalid JSON (e.g. { key: {{value}} } without quotes)
						body = this.fillStringTemplate(rawTemplate, variables, true);
					}
				} else {
					// STRATEGY: Raw String Replacement (For Text/Form data)
					// No JSON escaping needed for text/plain, but maybe URI encoding for form?
					// For simplicity, we stick to raw replacement here.
					body = this.fillStringTemplate(rawTemplate, variables, false);
				}
			}

			// 4. Headers & Content-Type
			const headers: Record<string, string> = {};

			if (profile.contentType === 'json') headers['Content-Type'] = 'application/json';
			else if (profile.contentType === 'form') headers['Content-Type'] = 'application/x-www-form-urlencoded';
			else if (profile.contentType === 'text') headers['Content-Type'] = 'text/plain';

			// Mix in custom headers
			for (const h of profile.headers) {
				let finalValue = h.value;

				if (h.type === 'secret') {
					if (this.app.secretStorage) {
						const secret = await this.app.secretStorage.getSecret(h.value); // await if needed, though getSecret is synchronous in some API versions, treating as safe.
						if (secret) finalValue = secret;
					}
				}
				// Support variables in headers too (e.g. Auth tokens dependent on logic? rare but possible)
				for (const [vKey, vVal] of Object.entries(variables)) {
					finalValue = finalValue.split(vKey).join(vVal);
				}
				headers[h.key] = finalValue;
			}

			// 5. Send Request
			const response = await requestUrl({
				url: profile.url.trim(),
				method: profile.method,
				headers: headers,
				body: body
			});

			if (response.status >= 200 && response.status < 300) {
				new Notice(`✅ ${profile.name} Sent!`);
			} else {
				new Notice(`⚠️ ${profile.name} Failed: ${response.status}`);
				console.error("Webhook Failed Body:", body||"");
			}

		} catch (e) {
			console.error(e);
			new Notice(`❌ Webhook Error: ${(e as Error).message}`);
		}
	}

	/**
	 * Recursively traverses a JSON object/array and replaces string values containing placeholders.
	 * This is safer because JSON.stringify() at the end handles all escaping (quotes, newlines).
	 */
	private fillTemplateRecursive(item: any, variables: Record<string, string>): any {
		if (typeof item === 'string') {
			let result = item;
			for (const [key, val] of Object.entries(variables)) {
				// We replace the placeholder with the raw value.
				// No need to escape quotes here, because 'result' is just a JS string variable.
				result = result.split(key).join(val);
			}
			return result;
		} else if (Array.isArray(item)) {
			return item.map(child => this.fillTemplateRecursive(child, variables));
		} else if (typeof item === 'object' && item !== null) {
			const newObj: any = {};
			for (const key in item) {
				newObj[key] = this.fillTemplateRecursive(item[key], variables);
			}
			return newObj;
		}
		return item;
	}

	/**
	 * The old "Brittle" method: Manually replacing text in a big string.
	 * Used for non-JSON content types or invalid JSON templates.
	 */
	private fillStringTemplate(template: string, variables: Record<string, string>, escapeForJson: boolean): string {
		let body = template;
		for (const [key, val] of Object.entries(variables)) {
			let safeVal = val;
			if (escapeForJson) {
				// Manual escaping: painful and prone to errors
				safeVal = safeVal.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
			}
			body = body.split(key).join(safeVal);
		}
		return body;
	}
}
