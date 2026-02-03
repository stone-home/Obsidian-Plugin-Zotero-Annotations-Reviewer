import { WebhookService } from './webhook';
import { App, TFile, requestUrl } from 'obsidian';
import { WebhookProfile } from '../types';

// Mock requestUrl from obsidian
jest.mock('obsidian', () => ({
	...jest.requireActual('obsidian'),
	requestUrl: jest.fn(),
	Notice: jest.fn() // Silence notices
}));

describe('WebhookService', () => {
	let app: App;
	let service: WebhookService;
	let mockFile: TFile;

	beforeAll(() => {
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		jest.spyOn(console, 'error').mockImplementation(() => {});
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
});
