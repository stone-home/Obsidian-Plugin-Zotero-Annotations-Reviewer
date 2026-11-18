import { TFile } from 'obsidian';
import {
	PROMPT_BASE64_MAX_LENGTH,
	WebhookService,
} from '../../../src/services/webhook';
import { DEFAULT_SETTINGS, MyPluginSettings, WebhookProfile } from '../../../src/types';
import {
	requestUrl,
	RequestUrlParam,
	resetObsidianMocks,
} from '../../__mocks__/obsidian';
import {
	createTestApp,
	getNoticeMessages,
	makeVaultFile,
	TestAppHarness,
} from '../../fixtures/vault';

function makeResponse(status: number, text = '') {
	return {
		status,
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
		json: null,
		text,
	};
}

function makeProfile(overrides: Partial<WebhookProfile> = {}): WebhookProfile {
	return {
		id: 'hook-1',
		name: 'Hook',
		icon: 'webhook',
		url: ' https://api.example.com/post ',
		method: 'POST',
		contentType: 'json',
		headers: [],
		bodyTemplate: '{}',
		hidden: false,
		...overrides,
	};
}

function base64(text: string): string {
	return Buffer.from(text, 'utf8').toString('base64');
}

function sentRequest(callIndex = 0): RequestUrlParam {
	const raw = requestUrl.mock.calls[callIndex][0];
	return typeof raw === 'string' ? { url: raw } : raw;
}

describe('WebhookService', () => {
	let harness: TestAppHarness;
	let service: WebhookService;
	let noteFile: TFile;

	beforeEach(() => {
		resetObsidianMocks();
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		jest.spyOn(console, 'error').mockImplementation(() => {});
		jest.spyOn(console, 'log').mockImplementation(() => {});
		jest.spyOn(console, 'group').mockImplementation(() => {});
		jest.spyOn(console, 'groupEnd').mockImplementation(() => {});

		harness = createTestApp();
		service = new WebhookService(harness.app);
		noteFile = harness.addFile('folder/test-note.md', 'line "one"\nline two', {
			status: 'wip',
		});
		requestUrl.mockResolvedValue(makeResponse(200));
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('shows error notice and aborts when profile URL is empty', async () => {
		await service.triggerWebhook(makeProfile({ url: '' }), noteFile);
		expect(requestUrl).not.toHaveBeenCalled();
		expect(getNoticeMessages()).toContain('❌ Webhook "Hook" has no URL.');
	});

	it('replaces variables recursively across JSON objects/arrays and preserves non-string literals', async () => {
		const profile = makeProfile({
			headers: [{ key: 'X-Custom', value: '{{filename}}', type: 'text' }],
			bodyTemplate: JSON.stringify({
				tags: ['{{frontmatter.status}}', '{{filename}}'],
				meta: { path: '{{path}}', count: 3, flag: true, nothing: null },
				text: '{{content}}',
				extra: '{{custom}}',
			}),
		});

		await service.triggerWebhook(profile, noteFile, { custom: 'hello' });

		const req = sentRequest();
		expect(req.url).toBe('https://api.example.com/post');
		expect(req.method).toBe('POST');
		expect(req.headers).toEqual({
			'Content-Type': 'application/json',
			'X-Custom': 'test-note.md',
		});
		expect(JSON.parse(String(req.body))).toEqual({
			tags: ['wip', 'test-note.md'],
			meta: {
				path: 'folder/test-note.md',
				count: 3,
				flag: true,
				nothing: null,
			},
			text: 'line "one"\nline two',
			extra: 'hello',
		});
		expect(getNoticeMessages()).toContain('✅ Hook Sent!');
	});

	it('fills absent or empty frontmatter placeholders with null', async () => {
		const file = harness.addFile('folder/sparse.md', 'body', {
			status: 'wip',
			empty: null,
		});

		await service.triggerWebhook(
			makeProfile({
				headers: [
					{
						key: 'X-Missing',
						value: '{{frontmatter.missing}}',
						type: 'text',
					},
				],
				bodyTemplate: JSON.stringify({
					present: '{{frontmatter.status}}',
					missing: '{{frontmatter.missing}}',
					empty: '{{frontmatter.empty}}',
					embedded: 'code: {{frontmatter.missing}}',
					list: ['{{frontmatter.missing}}'],
					other: '{{unknown}}',
				}),
			}),
			file
		);
		expect(JSON.parse(String(sentRequest(0).body))).toEqual({
			present: 'wip',
			missing: null,
			empty: null,
			embedded: 'code: null',
			list: [null],
			other: '{{unknown}}',
		});
		expect(sentRequest(0).headers?.['X-Missing']).toBe('null');

		// Text bodies and the invalid-JSON fallback get the literal text null
		await service.triggerWebhook(
			makeProfile({
				contentType: 'text',
				bodyTemplate: 'code={{frontmatter.missing}}',
			}),
			file
		);
		expect(sentRequest(1).body).toBe('code=null');

		await service.triggerWebhook(
			makeProfile({ bodyTemplate: '{"year": {{frontmatter.year}}}' }),
			file
		);
		expect(sentRequest(2).body).toBe('{"year": null}');
	});

	it('supports GET (no body), text/plain, form-urlencoded, invalid JSON fallback escaping, and debug logging', async () => {
		await service.triggerWebhook(
			makeProfile({
				method: 'GET',
				contentType: 'text',
				bodyTemplate: 'ignored',
			}),
			noteFile,
			undefined,
			true
		);
		expect(sentRequest(0).body).toBeUndefined();
		expect(console.group).toHaveBeenCalledWith('[Webhook Debug] Hook');
		expect(console.log).toHaveBeenCalledWith('Body:', '(none)');
		expect(getNoticeMessages()).toContain(
			'🔍 Webhook debug: check console for request details.'
		);

		await service.triggerWebhook(
			makeProfile({ contentType: 'form', bodyTemplate: 'file={{filename}}' }),
			noteFile
		);
		expect(sentRequest(1).headers?.['Content-Type']).toBe(
			'application/x-www-form-urlencoded'
		);
		expect(sentRequest(1).body).toBe('file=test-note.md');

		// Invalid JSON template falls back to escaped string replacement
		await service.triggerWebhook(
			makeProfile({
				contentType: 'json',
				bodyTemplate: '{"text": "{{content}}", invalid}',
			}),
			noteFile,
			undefined,
			true
		);
		expect(sentRequest(2).body).toBe(
			'{"text": "line \\"one\\"\\nline two", invalid}'
		);
	});

	it('resolves secret headers from SecretStorage, keeps raw value when secret is absent, and handles HTTP/network errors', async () => {
		harness.setSecret('my-secret-id', 'resolved-bearer-token');

		await service.triggerWebhook(
			makeProfile({
				headers: [
					{ key: 'Authorization', value: 'my-secret-id', type: 'secret' },
					{ key: 'X-Missing-Secret', value: 'missing-id', type: 'secret' },
				],
			}),
			noteFile
		);
		expect(sentRequest(0).headers).toMatchObject({
			Authorization: 'resolved-bearer-token',
			'X-Missing-Secret': 'missing-id',
		});

		requestUrl.mockResolvedValueOnce(makeResponse(500));
		await service.triggerWebhook(makeProfile({ name: 'Fail500' }), noteFile);
		expect(getNoticeMessages()).toContain('⚠️ Fail500 Failed: 500');

		requestUrl.mockRejectedValueOnce(new Error('Network down'));
		await service.triggerWebhook(makeProfile({ name: 'ErrHook' }), noteFile);
		expect(getNoticeMessages()).toContain('❌ Webhook Error: Network down');
	});

	describe('Paper Workspace & Prompt placeholders (with getSettings)', () => {
		let settings: MyPluginSettings;
		let settingsService: WebhookService;

		beforeEach(() => {
			settings = {
				...DEFAULT_SETTINGS,
				paperWorkspace: { ...DEFAULT_SETTINGS.paperWorkspace },
				prompts: [
					...DEFAULT_SETTINGS.prompts.map((p) => ({ ...p })),
					{
						id: 'inline_only',
						name: 'Inline Only',
						vaultPath: '   ',
						content: 'Inline custom prompt',
						builtIn: false,
					},
				],
			};
			settingsService = new WebhookService(harness.app, () => settings);
		});

		it('resolves {{citekey}}, {{path.*}}, {{prompt.<id>}}, and {{path.prompt.<id>}} while skipping kind="template" entries', async () => {
			const litFile = harness.addFile(
				'002-Literature/vaswani2017.md',
				'Paper markdown body',
				{ 'citation-key': 'vaswani2017' }
			);
			const vaultPromptText =
				'# Vault Prompt\nUse "exact quotes" and $\\sum_{i=1}^{n} x_i$ in output.';
			harness.addFile('900-Templates/prompt-synthesize.md', vaultPromptText);

			const profile = makeProfile({
				headers: [
					{ key: 'X-Citekey', value: '{{citekey}}', type: 'text' },
					{
						key: 'X-Tpl-Skipped',
						value: '{{prompt.tpl-report1}}',
						type: 'text',
					},
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
					prompts: {
						fromVault: '{{prompt.synthesize}}',
						fromInline: '{{prompt.inline_only}}',
						synthPath: '{{path.prompt.synthesize}}',
						emptyPath: '{{path.prompt.inline_only}}',
						skippedTpl: '{{prompt.tpl-report1}}',
						skippedTplPath: '{{path.prompt.tpl-report1}}',
					},
				}),
			});

			await settingsService.triggerWebhook(profile, litFile);

			const req = sentRequest();
			expect(req.headers?.['X-Citekey']).toBe('vaswani2017');
			expect(req.headers?.['X-Tpl-Skipped']).toBe('{{prompt.tpl-report1}}');

			const parsed = JSON.parse(String(req.body)) as {
				citekey: string;
				paths: Record<string, string>;
				prompts: Record<string, string>;
			};
			expect(parsed.citekey).toBe('vaswani2017');
			expect(parsed.paths).toEqual({
				zotero: '002-Literature/vaswani2017.md',
				report1:
					'002-Literature/102-Analysis Report/Deep Research-vaswani2017.md',
				report2:
					'002-Literature/103-External Analysis Report/External Research-vaswani2017.md',
				takeaway: '002-Literature/101-Takeaways/Takeaway-vaswani2017.md',
				coreNote: '002-Literature/104-Paper Notes/vaswani2017.md',
			});
			expect(parsed.prompts).toEqual({
				fromVault: base64(vaultPromptText),
				fromInline: base64('Inline custom prompt'),
				synthPath: '900-Templates/prompt-synthesize.md',
				emptyPath: '',
				skippedTpl: '{{prompt.tpl-report1}}',
				skippedTplPath: '{{path.prompt.tpl-report1}}',
			});
		});

		it('sends prompt content as UTF-8 Base64 and refuses a referenced prompt over the length limit', async () => {
			const litFile = harness.addFile('002-Literature/he2016.md', 'Body', {
				'citation-key': 'he2016',
			});
			const unicodePrompt = '总结这篇论文 — "résumé" 🚀\nline two';
			settings.prompts.push(
				{
					id: 'unicode',
					name: 'Unicode',
					vaultPath: '',
					content: unicodePrompt,
					builtIn: false,
				},
				{
					id: 'huge',
					name: 'Huge',
					vaultPath: '900-Templates/prompt-huge.md',
					content: 'x'.repeat(PROMPT_BASE64_MAX_LENGTH),
					builtIn: false,
				}
			);

			// An oversized prompt the template does not reference never blocks sending
			await settingsService.triggerWebhook(
				makeProfile({
					bodyTemplate: JSON.stringify({
						prompt: '{{prompt.unicode}}',
						hugePath: '{{path.prompt.huge}}',
					}),
				}),
				litFile
			);
			expect(JSON.parse(String(sentRequest(0).body))).toEqual({
				prompt: base64(unicodePrompt),
				hugePath: '900-Templates/prompt-huge.md',
			});

			await settingsService.triggerWebhook(
				makeProfile({ bodyTemplate: '{"prompt": "{{prompt.huge}}"}' }),
				litFile
			);
			expect(requestUrl).toHaveBeenCalledTimes(1);
			const encodedKb = (
				base64('x'.repeat(PROMPT_BASE64_MAX_LENGTH)).length / 1024
			).toFixed(1);
			expect(getNoticeMessages()).toContain(
				`❌ {{prompt.huge}} is too long to send: ${encodedKb} KB as Base64, limit 20 KB. Use {{path.prompt.huge}} instead.`
			);

			// A prompt whose Base64 is exactly at the limit is still sent
			const atLimit = 'x'.repeat((PROMPT_BASE64_MAX_LENGTH / 4) * 3);
			settings.prompts.push({
				id: 'edge',
				name: 'Edge',
				vaultPath: '',
				content: atLimit,
				builtIn: false,
			});
			await settingsService.triggerWebhook(
				makeProfile({ bodyTemplate: '{"prompt": "{{prompt.edge}}"}' }),
				litFile
			);
			expect(JSON.parse(String(sentRequest(1).body))).toEqual({
				prompt: base64(atLimit),
			});
			expect(base64(atLimit)).toHaveLength(PROMPT_BASE64_MAX_LENGTH);
		});

		it('falls back to filename basename when frontmatter has no citation key', async () => {
			const bareFile = makeVaultFile('002-Literature/dean2008.md');
			harness.addFile('002-Literature/dean2008.md', 'Body without frontmatter');

			await settingsService.triggerWebhook(
				makeProfile({ bodyTemplate: '{"citekey": "{{citekey}}"}' }),
				bareFile
			);
			expect(JSON.parse(String(sentRequest().body))).toEqual({
				citekey: 'dean2008',
			});
		});
	});
});
