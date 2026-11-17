import { App, Notice, requestUrl, TFile } from 'obsidian';
import { MyPluginSettings, WebhookProfile } from '../types';
import { normalizePath } from '../utils/paths';
import { resolvePaperPaths } from './paper-hub';

export class WebhookService {
	private app: App;
	private getSettings?: () => MyPluginSettings;

	constructor(app: App, getSettings?: () => MyPluginSettings) {
		this.app = app;
		this.getSettings = getSettings;
	}

	async triggerWebhook(
		profile: WebhookProfile,
		file: TFile,
		extraVariables?: Record<string, string>,
		debugMode?: boolean
	) {
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
			const safePath = String(file.path ?? '');
			const safeFilename = String(file.name ?? (safePath.split('/').pop() || ''));
			const variables: Record<string, string> = {
				'{{filename}}': safeFilename,
				'{{path}}': safePath,
				'{{content}}': String(content ?? ''),
				'{{timestamp}}': new Date().toISOString(),
			};

			Object.keys(frontmatter).forEach((key) => {
				variables[`{{frontmatter.${key}}}`] = String(frontmatter[key]);
			});

			// 2b. Paper Workspace & Prompt Placeholders
			if (this.getSettings) {
				const settings = this.getSettings();
				const fallbackName = (file.basename || safeFilename).replace(
					/\.md$/i,
					''
				);
				const rawCitekey =
					frontmatter[settings.citationKeyName] ||
					frontmatter['citation-key'] ||
					frontmatter['zotero-key'] ||
					fallbackName;
				const citekey = String(rawCitekey).trim();
				const paths = resolvePaperPaths(settings.paperWorkspace, citekey);

				variables['{{citekey}}'] = citekey;
				variables['{{path.zotero_note}}'] = paths.literatureNote;
				variables['{{path.report1}}'] = paths.report1;
				variables['{{path.report2}}'] = paths.report2;
				variables['{{path.takeaway}}'] = paths.takeaway;
				variables['{{path.core_note}}'] = paths.coreNote;

				const promptEntries = (settings.prompts || []).filter(
					(p) => (p.kind ?? 'prompt') === 'prompt'
				);
				const resolvedPrompts = await Promise.all(
					promptEntries.map(async (prompt) => {
						const vPath = prompt.vaultPath?.trim()
							? normalizePath(prompt.vaultPath.trim())
							: '';
						const vaultFile = vPath
							? this.app.vault.getAbstractFileByPath(vPath)
							: null;
						const promptContent =
							vaultFile instanceof TFile
								? await this.app.vault.read(vaultFile)
								: prompt.content;
						return { id: prompt.id, content: promptContent, path: vPath };
					})
				);

				for (const item of resolvedPrompts) {
					variables[`{{prompt.${item.id}}}`] = String(item.content ?? '');
					variables[`{{path.prompt.${item.id}}}`] = String(item.path ?? '');
				}
			}

			if (extraVariables) {
				for (const [key, val] of Object.entries(extraVariables)) {
					variables[`{{${key}}}`] = String(val ?? '');
				}
			}

			// 3. Body Construction (The Safer Way)
			let body: string | undefined = undefined;

			if (profile.method !== 'GET') {
				const rawTemplate = profile.bodyTemplate || '';

				if (profile.contentType === 'json' && rawTemplate.trim().length > 0) {
					try {
						const templateObj = JSON.parse(rawTemplate);
						const filledObj = this.fillTemplateRecursive(
							templateObj,
							variables
						);
						body = JSON.stringify(filledObj);
					} catch (e) {
						console.warn(
							'Webhook template is not valid JSON, falling back to raw string replacement.',
							e
						);
						body = this.fillStringTemplate(rawTemplate, variables, true);
					}
				} else {
					body = this.fillStringTemplate(rawTemplate, variables, false);
				}
			}

			// 4. Headers & Content-Type
			const headers: Record<string, string> = {};

			if (profile.contentType === 'json')
				headers['Content-Type'] = 'application/json';
			else if (profile.contentType === 'form')
				headers['Content-Type'] = 'application/x-www-form-urlencoded';
			else if (profile.contentType === 'text')
				headers['Content-Type'] = 'text/plain';

			for (const h of profile.headers) {
				let finalValue = String(h.value ?? '');

				if (h.type === 'secret' && this.app.secretStorage) {
					const secret = await this.app.secretStorage.getSecret(h.value);
					if (secret) finalValue = secret;
				}
				for (const [vKey, vVal] of Object.entries(variables)) {
					finalValue = finalValue.split(vKey).join(String(vVal ?? ''));
				}
				headers[h.key] = finalValue;
			}

			// 5. Debug: log headers and body when debug mode is on
			if (debugMode) {
				console.group(`[Webhook Debug] ${profile.name}`);
				console.log('URL:', profile.url.trim());
				console.log('Method:', profile.method);
				console.log('Headers:', headers);
				console.log('Body:', body ?? '(none)');
				console.groupEnd();
				new Notice('🔍 Webhook debug: check console for request details.');
			}

			// 6. Send Request
			const response = await requestUrl({
				url: profile.url.trim(),
				method: profile.method,
				headers,
				body,
			});

			if (response.status >= 200 && response.status < 300) {
				new Notice(`✅ ${profile.name} Sent!`);
			} else {
				new Notice(`⚠️ ${profile.name} Failed: ${response.status}`);
				console.error('Webhook Failed Body:', body || '');
			}
		} catch (e) {
			console.error(e);
			new Notice(`❌ Webhook Error: ${(e as Error).message}`);
		}
	}

	private fillTemplateRecursive(
		item: unknown,
		variables: Record<string, string>
	): unknown {
		if (typeof item === 'string') {
			let result = item;
			for (const [key, val] of Object.entries(variables)) {
				result = result.split(key).join(String(val ?? ''));
			}
			return result;
		} else if (Array.isArray(item)) {
			return item.map((child) => this.fillTemplateRecursive(child, variables));
		} else if (typeof item === 'object' && item !== null) {
			const newObj: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(
				item as Record<string, unknown>
			)) {
				newObj[key] = this.fillTemplateRecursive(value, variables);
			}
			return newObj;
		}
		return item;
	}

	private fillStringTemplate(
		template: string,
		variables: Record<string, string>,
		escapeForJson: boolean
	): string {
		let body = template;
		for (const [key, val] of Object.entries(variables)) {
			let safeVal = String(val ?? '');
			if (escapeForJson) {
				safeVal = safeVal
					.replace(/\\/g, '\\\\')
					.replace(/\n/g, '\\n')
					.replace(/"/g, '\\"');
			}
			body = body.split(key).join(safeVal);
		}
		return body;
	}
}
