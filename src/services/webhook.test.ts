import { WebhookService } from './webhook';
import { App, TFile, requestUrl } from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings, WebhookProfile } from '../types';

// Mock requestUrl from obsidian
jest.mock('obsidian', () => ({
	...jest.requireActual('obsidian'),
	requestUrl: jest.fn(),
	Notice: jest.fn() // Silence notices
}));

function makeVaultFile(path: string): TFile {
	const file = new TFile();
	const name = path.split('/').pop() || path;
	const basename = name.replace(/\.md$/i, '');
	Object.assign(file, { path, name, basename, extension: 'md' });
	return file;
}

describe('WebhookService', () => {
	let app: App;
	let service: WebhookService;
	let mockFile: TFile;

	beforeAll(() => {
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		jest.spyOn(console, 'error').mockImplementation(() => {});
		jest.spyOn(console, 'group').mockImplementation(() => {});
		jest.spyOn(console, 'groupEnd').mockImplementation(() => {});
		jest.spyOn(console, 'log').mockImplementation(() => {});
	});

	// 2. Restore console logs after tests finish (Critical!)
	afterAll(() => {
		jest.restoreAllMocks();
	});

	beforeEach(() => {
		jest.clearAllMocks();
		app = new App();
		service = new WebhookService(app);

		// Mock File
		mockFile = new TFile();
		// @ts-ignore
		mockFile.name = 'test-note.md';
		// @ts-ignore
		mockFile.path = 'folder/test-note.md';

		// Mock Vault & Metadata
		// Ensure your __mocks__/obsidian.ts has 'read' and 'getFileCache' mocked as shown in previous steps
		(app.vault.read as jest.Mock).mockResolvedValue('File content here');
		(app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
			frontmatter: { status: 'wip' }
		});
	});

	it('should trigger webhook with correct variable replacement', async () => {
		const profile: WebhookProfile = {
			// --- ADDED MISSING FIELDS ---
			id: 'test-hook-1',
			icon: 'webhook',
			hidden: false,
			// ----------------------------
			name: 'Test Hook',
			url: 'https://api.example.com/post',
			method: 'POST',
			contentType: 'json',
			headers: [{ key: 'X-Custom', value: '{{filename}}', type: 'text' }],
			bodyTemplate: '{"content": "{{content}}", "status": "{{frontmatter.status}}"}'
		};

		// Mock successful network response
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200 });

		await service.triggerWebhook(profile, mockFile);

		expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
			url: 'https://api.example.com/post',
			method: 'POST',
			headers: expect.objectContaining({
				'Content-Type': 'application/json',
				'X-Custom': 'test-note.md'
			}),
			body: expect.stringContaining(JSON.stringify({"content": "File content here", "status": "wip"}))
		}));
	});

	it('should handle 404 errors gracefully', async () => {
		const profile: WebhookProfile = {
			id: 'test-hook-2',
			icon: 'cross',
			hidden: false,
			name: 'Fail',
			url: 'bad-url',
			method: 'GET',
			contentType: 'json',
			headers: [],
			bodyTemplate: ''
		};

		(requestUrl as jest.Mock).mockResolvedValue({ status: 404 });

		await expect(service.triggerWebhook(profile, mockFile)).resolves.not.toThrow();
	});

	it('should show notice and return when profile has no URL', async () => {
		const profile: WebhookProfile = {
			id: 'no-url',
			name: 'No URL',
			icon: 'link',
			url: '',
			method: 'POST',
			contentType: 'json',
			headers: [],
			bodyTemplate: '{}',
			hidden: false
		};
		await service.triggerWebhook(profile, mockFile);
		expect(requestUrl).not.toHaveBeenCalled();
	});

	it('should merge extraVariables into body template', async () => {
		const profile: WebhookProfile = {
			id: 'extra',
			name: 'Extra Vars',
			icon: 'edit',
			url: 'https://api.example.com/post',
			method: 'POST',
			contentType: 'json',
			headers: [],
			bodyTemplate: '{"label": "{{custom}}", "id": "{{id}}"}',
			hidden: false
		};
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200 });
		await service.triggerWebhook(profile, mockFile, { custom: 'hello', id: '42' });
		const call = (requestUrl as jest.Mock).mock.calls[0][0];
		expect(call.body).toContain('"label":"hello"');
		expect(call.body).toContain('"id":"42"');
	});

	it('should not send body for GET method', async () => {
		const profile: WebhookProfile = {
			id: 'get-hook',
			name: 'GET Hook',
			icon: 'download',
			url: 'https://api.example.com/get',
			method: 'GET',
			contentType: 'json',
			headers: [],
			bodyTemplate: '{"x": "y"}',
			hidden: false
		};
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200 });
		await service.triggerWebhook(profile, mockFile);
		expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
			method: 'GET',
			body: undefined
		}));
	});

	it('should use text/plain content type for text body', async () => {
		const profile: WebhookProfile = {
			id: 'text-hook',
			name: 'Text',
			icon: 'file-text',
			url: 'https://api.example.com/text',
			method: 'POST',
			contentType: 'text',
			headers: [],
			bodyTemplate: 'Hello {{filename}}',
			hidden: false
		};
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200 });
		await service.triggerWebhook(profile, mockFile);
		expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
			headers: expect.objectContaining({ 'Content-Type': 'text/plain' }),
			body: 'Hello test-note.md'
		}));
	});

	it('should use form content type for form body', async () => {
		const profile: WebhookProfile = {
			id: 'form-hook',
			name: 'Form',
			icon: 'form',
			url: 'https://api.example.com/form',
			method: 'POST',
			contentType: 'form',
			headers: [],
			bodyTemplate: 'key={{filename}}',
			hidden: false
		};
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200 });
		await service.triggerWebhook(profile, mockFile);
		expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
			headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' })
		}));
	});

	it('should fallback to raw string replacement for invalid JSON template', async () => {
		const profile: WebhookProfile = {
			id: 'bad-json',
			name: 'Bad JSON',
			icon: 'alert',
			url: 'https://api.example.com/post',
			method: 'POST',
			contentType: 'json',
			headers: [],
			bodyTemplate: 'not valid json {{filename}}',
			hidden: false
		};
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200 });
		await service.triggerWebhook(profile, mockFile);
		expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
			body: expect.stringContaining('test-note.md')
		}));
	});

	it('should handle request throwing', async () => {
		const profile: WebhookProfile = {
			id: 'err',
			name: 'Error',
			icon: 'x',
			url: 'https://api.example.com/post',
			method: 'POST',
			contentType: 'json',
			headers: [],
			bodyTemplate: '{}',
			hidden: false
		};
		(requestUrl as jest.Mock).mockRejectedValue(new Error('Network error'));
		await expect(service.triggerWebhook(profile, mockFile)).resolves.not.toThrow();
	});

	it('should replace variables in headers', async () => {
		const profile: WebhookProfile = {
			id: 'hdr',
			name: 'Headers',
			icon: 'key',
			url: 'https://api.example.com/post',
			method: 'POST',
			contentType: 'json',
			headers: [{ key: 'X-File', value: '{{filename}}', type: 'text' }],
			bodyTemplate: '{}',
			hidden: false
		};
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200 });
		await service.triggerWebhook(profile, mockFile);
		expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
			headers: expect.objectContaining({ 'X-File': 'test-note.md' })
		}));
	});

	it('should show failure notice when response status is not 2xx', async () => {
		const profile: WebhookProfile = {
			id: 'fail',
			name: 'Fail',
			icon: 'x',
			url: 'https://api.example.com/post',
			method: 'POST',
			contentType: 'json',
			headers: [],
			bodyTemplate: '{}',
			hidden: false
		};
		(requestUrl as jest.Mock).mockResolvedValue({ status: 500 });
		await service.triggerWebhook(profile, mockFile);
		expect(requestUrl).toHaveBeenCalled();
	});

	it('should use secret from secretStorage for secret header type', async () => {
		const profile: WebhookProfile = {
			id: 'secret-hdr',
			name: 'Secret',
			icon: 'lock',
			url: 'https://api.example.com/post',
			method: 'POST',
			contentType: 'json',
			headers: [{ key: 'Authorization', value: 'my-secret-key', type: 'secret' }],
			bodyTemplate: '{}',
			hidden: false
		};
		(app.secretStorage.getSecret as jest.Mock).mockResolvedValue('resolved-secret');
		(requestUrl as jest.Mock).mockResolvedValue({ status: 200 });
		await service.triggerWebhook(profile, mockFile);
		expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
			headers: expect.objectContaining({ 'Authorization': 'resolved-secret' })
		}));
	});

	describe('with getSettings (Paper Workspace, S3 & Prompt placeholders)', () => {
		let settings: MyPluginSettings;
		let settingsService: WebhookService;

		beforeEach(() => {
			settings = {
				...DEFAULT_SETTINGS,
				paperWorkspace: {
					...DEFAULT_SETTINGS.paperWorkspace,
					s3Prefix: 's3://research-bucket/obsidian-vault/',
				},
				prompts: [
					{
						id: 'synthesize',
						name: 'Synthesize Takeaway',
						vaultPath: '002-Literature/100-Prompts/synthesize.md',
						content: 'Fallback synthesize prompt',
						builtIn: true,
					},
					{
						id: 'report1',
						name: 'Report 1',
						vaultPath: '002-Literature/100-Prompts/report1.md',
						content: 'Line 1 with "quotes"\nLine 2 with LaTeX $\\frac{\\alpha}{\\beta}$',
						builtIn: true,
					},
					{
						id: 'inline_only',
						name: 'Inline Only',
						vaultPath: '',
						content: 'Inline custom prompt',
						builtIn: false,
					},
				],
			};
			settingsService = new WebhookService(app, () => settings);
		});

		it('resolves {{citekey}}, {{path.*}}, {{s3.*}}, {{prompt.<id>}}, and {{s3.prompt.<id>}} with s3:// prefix', async () => {
			const litFile = makeVaultFile('002-Literature/vaswani2017.md');
			const vaultPromptFile = makeVaultFile('002-Literature/100-Prompts/synthesize.md');
			const vaultPromptText =
				'# Vault Prompt\nUse "exact quotes" and $\\sum_{i=1}^{n} x_i$ in output.';

			(app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
				frontmatter: { 'citation-key': 'vaswani2017' },
			});
			(app.vault.getAbstractFileByPath as jest.Mock).mockImplementation((p: string) =>
				p === '002-Literature/100-Prompts/synthesize.md' ? vaultPromptFile : null
			);
			(app.vault.read as jest.Mock).mockImplementation(async (f: TFile) =>
				f === vaultPromptFile ? vaultPromptText : 'Paper markdown body'
			);
			(requestUrl as jest.Mock).mockResolvedValue({ status: 200 });

			const profile: WebhookProfile = {
				id: 'paper-pipeline',
				name: 'Paper Pipeline',
				icon: 'rocket',
				url: 'https://n8n.example.com/webhook/paper',
				method: 'POST',
				contentType: 'json',
				headers: [
					{ key: 'X-Citekey', value: '{{citekey}}', type: 'text' },
					{ key: 'X-S3-Takeaway', value: '{{s3.takeaway}}', type: 'text' },
					{ key: 'X-Inline-Prompt', value: '{{prompt.inline_only}}', type: 'text' },
				],
				bodyTemplate: JSON.stringify({
					citekey: '{{citekey}}',
					paths: {
						zotero: '{{path.zotero_note}}',
						report1: '{{path.report1}}',
						report2: '{{path.report2}}',
						takeaway: '{{path.takeaway}}',
						coreNote: '{{path.core_note}}',
					},
					s3: [
						'{{s3.zotero_note}}',
						'{{s3.report1}}',
						'{{s3.report2}}',
						'{{s3.takeaway}}',
						'{{s3.core_note}}',
					],
					prompts: {
						fromVault: '{{prompt.synthesize}}',
						fromFallback: '{{prompt.report1}}',
						s3VaultPrompt: '{{s3.prompt.synthesize}}',
						s3EmptyPath: '{{s3.prompt.inline_only}}',
					},
					retryCount: 2,
				}),
				hidden: false,
			};

			await settingsService.triggerWebhook(profile, litFile, undefined, true);

			expect(requestUrl).toHaveBeenCalledTimes(1);
			const req = (requestUrl as jest.Mock).mock.calls[0][0];
			expect(req.headers['X-Citekey']).toBe('vaswani2017');
			expect(req.headers['X-S3-Takeaway']).toBe(
				's3://research-bucket/obsidian-vault/002-Literature/101-Takeaways/Takeaway-vaswani2017.md'
			);
			expect(req.headers['X-Inline-Prompt']).toBe('Inline custom prompt');

			const parsed = JSON.parse(req.body);
			expect(parsed.citekey).toBe('vaswani2017');
			expect(parsed.paths).toEqual({
				zotero: '002-Literature/vaswani2017.md',
				report1: '002-Literature/102-Analysis Report/Deep Research-vaswani2017.md',
				report2: '002-Literature/103-External Analysis Report/External Research-vaswani2017.md',
				takeaway: '002-Literature/101-Takeaways/Takeaway-vaswani2017.md',
				coreNote: '002-Literature/104-Paper Notes/vaswani2017.md',
			});
			expect(parsed.s3).toEqual([
				's3://research-bucket/obsidian-vault/002-Literature/vaswani2017.md',
				's3://research-bucket/obsidian-vault/002-Literature/102-Analysis Report/Deep Research-vaswani2017.md',
				's3://research-bucket/obsidian-vault/002-Literature/103-External Analysis Report/External Research-vaswani2017.md',
				's3://research-bucket/obsidian-vault/002-Literature/101-Takeaways/Takeaway-vaswani2017.md',
				's3://research-bucket/obsidian-vault/002-Literature/104-Paper Notes/vaswani2017.md',
			]);
			expect(parsed.prompts.fromVault).toBe(vaultPromptText);
			expect(parsed.prompts.fromFallback).toBe(
				'Line 1 with "quotes"\nLine 2 with LaTeX $\\frac{\\alpha}{\\beta}$'
			);
			expect(parsed.prompts.s3VaultPrompt).toBe(
				's3://research-bucket/obsidian-vault/002-Literature/100-Prompts/synthesize.md'
			);
			expect(parsed.prompts.s3EmptyPath).toBe('');
			expect(parsed.retryCount).toBe(2);
			expect(console.group).toHaveBeenCalled();
		});

		it('falls back to file path basename when frontmatter is absent and s3Prefix is empty', async () => {
			settings.paperWorkspace = {
				...settings.paperWorkspace,
				s3Prefix: '',
			};
			const bareFile = new TFile();
			Object.assign(bareFile, { path: '002-Literature/dean2008.md' });

			(app.metadataCache.getFileCache as jest.Mock).mockReturnValue(null);
			(app.vault.getAbstractFileByPath as jest.Mock).mockReturnValue(null);
			(requestUrl as jest.Mock).mockResolvedValue({ status: 200 });

			const profile: WebhookProfile = {
				id: 'raw-json-escape',
				name: 'Raw JSON Escape',
				icon: 'code',
				url: 'https://api.example.com/raw',
				method: 'POST',
				contentType: 'json',
				headers: [],
				// Intentionally unquoted trailing token so JSON.parse fails and fillStringTemplate(..., true) runs
				bodyTemplate:
					'{"citekey":"{{citekey}}","s3":"{{s3.zotero_note}}","prompt":"{{prompt.report1}}",raw:true}',
				hidden: false,
			};

			await settingsService.triggerWebhook(profile, bareFile);

			const req = (requestUrl as jest.Mock).mock.calls[0][0];
			expect(req.body).toContain('"citekey":"dean2008"');
			expect(req.body).toContain('"s3":"002-Literature/dean2008.md"');
			expect(req.body).toContain(
				'Line 1 with \\"quotes\\"\\nLine 2 with LaTeX $\\\\frac{\\\\alpha}{\\\\beta}$'
			);
		});

		it('logs (none) body when debugMode is enabled on GET requests', async () => {
			(requestUrl as jest.Mock).mockResolvedValue({ status: 200 });
			const profile: WebhookProfile = {
				id: 'debug-get',
				name: 'Debug GET',
				icon: 'bug',
				url: 'https://api.example.com/ping',
				method: 'GET',
				contentType: 'text',
				headers: [],
				bodyTemplate: '',
				hidden: false,
			};

			await settingsService.triggerWebhook(profile, mockFile, undefined, true);
			expect(console.log).toHaveBeenCalledWith('Body:', '(none)');
		});
	});
});
