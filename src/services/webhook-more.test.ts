import { WebhookService } from './webhook';
import { App, Notice, TFile, requestUrl } from 'obsidian';
import { WebhookProfile } from '../types';

jest.mock('obsidian', () => ({
	...jest.requireActual('obsidian'),
	requestUrl: jest.fn(),
	Notice: jest.fn(),
}));

describe('WebhookService additional coverage', () => {
	let app: App;
	let service: WebhookService;
	let file: TFile;

	const makeProfile = (overrides: Partial<WebhookProfile> = {}): WebhookProfile => ({
		id: 'hook',
		icon: 'webhook',
		hidden: false,
		name: 'Hook',
		url: ' https://api.example.com/post ',
		method: 'POST',
		contentType: 'json',
		headers: [],
		bodyTemplate: '',
		...overrides,
	});

	const sentRequest = () => (requestUrl as jest.Mock).mock.calls[0][0];
	const noticeMessages = (): string[] =>
		(Notice as unknown as jest.Mock).mock.calls.map((c) => c[0]);

	beforeAll(() => {
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		jest.spyOn(console, 'error').mockImplementation(() => {});
		jest.spyOn(console, 'log').mockImplementation(() => {});
		jest.spyOn(console, 'group').mockImplementation(() => {});
		jest.spyOn(console, 'groupEnd').mockImplementation(() => {});
	});

	afterAll(() => {
		jest.restoreAllMocks();
	});

	beforeEach(() => {
		jest.clearAllMocks();
		app = new App();
		service = new WebhookService(app);
		file = new TFile();
		(file as any).name = 'note.md';
		(file as any).path = 'folder/note.md';
		(app.vault.read as jest.Mock).mockResolvedValue('line "one"\nline two');
		(app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
			frontmatter: { status: 'wip' },
		});
		(requestUrl as jest.Mock).mockResolvedValue({ status: 204 });
	});

	it('fills nested arrays and objects and keeps non-string values', async () => {
		const profile = makeProfile({
			bodyTemplate: JSON.stringify({
				tags: ['{{frontmatter.status}}', '{{filename}}'],
				meta: { path: '{{path}}', count: 3, flag: true, nothing: null },
				text: '{{content}}',
			}),
		});

		await service.triggerWebhook(profile, file);

		expect(JSON.parse(sentRequest().body)).toEqual({
			tags: ['wip', 'note.md'],
			meta: { path: 'folder/note.md', count: 3, flag: true, nothing: null },
			text: 'line "one"\nline two',
		});
		expect(sentRequest().url).toBe('https://api.example.com/post');
		expect(noticeMessages()).toContain('✅ Hook Sent!');
	});

	it('logs the request and shows a notice in debug mode', async () => {
		const profile = makeProfile({ bodyTemplate: '{"file": "{{filename}}"}' });

		await service.triggerWebhook(profile, file, undefined, true);

		expect(console.group).toHaveBeenCalledWith('[Webhook Debug] Hook');
		expect(console.log).toHaveBeenCalledWith(
			'URL:',
			'https://api.example.com/post'
		);
		expect(console.log).toHaveBeenCalledWith('Method:', 'POST');
		expect(console.log).toHaveBeenCalledWith('Headers:', {
			'Content-Type': 'application/json',
		});
		expect(console.log).toHaveBeenCalledWith('Body:', '{"file":"note.md"}');
		expect(console.groupEnd).toHaveBeenCalled();
		expect(noticeMessages()).toContain(
			'🔍 Webhook debug: check console for request details.'
		);
		expect(requestUrl).toHaveBeenCalledTimes(1);
	});

	it('logs "(none)" as body in debug mode for GET requests', async () => {
		await service.triggerWebhook(
			makeProfile({ method: 'GET' }),
			file,
			undefined,
			true
		);

		expect(console.log).toHaveBeenCalledWith('Body:', '(none)');
		expect(sentRequest().body).toBeUndefined();
	});

	it('escapes values when falling back to string replacement for invalid JSON', async () => {
		const profile = makeProfile({ bodyTemplate: '{"text": "{{content}}", bad}' });

		await service.triggerWebhook(profile, file);

		expect(sentRequest().body).toBe('{"text": "line \\"one\\"\\nline two", bad}');
	});

	it('keeps the header value when no secret is stored and tolerates missing frontmatter', async () => {
		(app.secretStorage.getSecret as jest.Mock).mockReturnValue(null);
		(app.metadataCache.getFileCache as jest.Mock).mockReturnValue(null);
		const profile = makeProfile({
			contentType: 'text',
			headers: [{ key: 'Authorization', value: 'secret-id', type: 'secret' }],
			bodyTemplate: '{{frontmatter.status}}|{{extra}}',
		});

		await service.triggerWebhook(profile, file, { extra: 'value' });

		expect(sentRequest().headers).toEqual({
			'Content-Type': 'text/plain',
			Authorization: 'secret-id',
		});
		expect(sentRequest().body).toBe('{{frontmatter.status}}|value');
	});
});
