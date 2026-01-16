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
		(app.vault.read as jest.Mock).mockResolvedValue('File content here');
		(app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
			frontmatter: { status: 'wip' }
		});
	});

	it('should trigger webhook with correct variable replacement', async () => {
		const profile: WebhookProfile = {
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
				'X-Custom': 'test-note.md' // Header variable replaced
			}),
			body: expect.stringContaining('"content": "File content here"') // Body variable replaced
		}));
	});

	it('should handle 404 errors gracefully', async () => {
		const profile: WebhookProfile = { name: 'Fail', url: 'bad-url', method: 'GET', contentType: 'json', headers: [], bodyTemplate: '' };

		(requestUrl as jest.Mock).mockResolvedValue({ status: 404 });

		// Should not throw, just log/notify
		await expect(service.triggerWebhook(profile, mockFile)).resolves.not.toThrow();
	});
});
