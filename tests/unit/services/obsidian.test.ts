import { ObsidianService } from '../../../src/services/obsidian';
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	ZoteroAnnotation,
	ZoteroItemMetadata,
} from '../../../src/types';
import { resetObsidianMocks } from '../../__mocks__/obsidian';
import { createTestApp, getNoticeMessages, TestAppHarness } from '../../fixtures/vault';

function makeAnnotation(overrides: Partial<ZoteroAnnotation> = {}): ZoteroAnnotation {
	return {
		key: 'anno1',
		citationKey: 'author2020',
		type: 'highlight',
		text: 'Important quote',
		comment: 'My thought',
		color: '#ffd400',
		pageLabel: '3',
		link: 'zotero://open-pdf/library/items/ABC?page=3&annotation=anno1',
		attachmentTitle: 'paper.pdf',
		date: '2024-01-01',
		...overrides,
	};
}

function makeMetadata(overrides: Partial<ZoteroItemMetadata> = {}): ZoteroItemMetadata {
	return {
		key: 'key123',
		itemType: 'journalArticle',
		title: 'Deep Learning',
		creators: ['Yann LeCun', 'Geoffrey Hinton'],
		date: '2015',
		publication: 'Nature',
		doi: '10.1038/nature14539',
		url: 'https://doi.org/10.1038/nature14539',
		abstract: 'Intro to AI',
		tags: ['ai'],
		zoteroNotes: [],
		...overrides,
	};
}

describe('ObsidianService (with real markdown-note-orm)', () => {
	let harness: TestAppHarness;
	let settings: MyPluginSettings;
	let service: ObsidianService;

	beforeEach(() => {
		resetObsidianMocks();
		harness = createTestApp();
		settings = {
			...DEFAULT_SETTINGS,
			fleetingNoteFolder: 'Fleeting',
			annotationKeyName: 'anno-key',
			citationKeyName: 'cite-key',
		};
		service = new ObsidianService(harness.app, settings);
	});

	describe('createLiteratureNote', () => {
		it('creates folder and writes a new literature note with properties and Abstract section', async () => {
			const created = await service.createLiteratureNote(makeMetadata());

			expect(created.path).toBe('Fleeting/@key123 - Deep Learning.md');
			const content = harness.getContent(created.path) ?? '';
			expect(content).toContain('type: literature');
			expect(content).toContain('zotero-key: key123');
			expect(content).toContain('year: 2015');
			expect(content).toContain('publication: Nature');
			expect(content).toContain('## Abstract');
			expect(content).toContain('Intro to AI');
		});

		it('patches an existing literature note when path already exists and omits empty Abstract', async () => {
			harness.addFolder('Fleeting');
			const first = await service.createLiteratureNote(
				makeMetadata({
					key: 'K1',
					title: 'A/B: Title?',
					abstract: '',
				})
			);
			expect(first.path).toBe('Fleeting/@K1 - AB Title.md');
			expect(harness.getContent(first.path)).not.toContain('## Abstract');

			const updated = await service.createLiteratureNote(
				makeMetadata({
					key: 'K1',
					title: 'A/B: Title?',
					date: '2021',
					abstract: 'Added abstract later',
				})
			);
			expect(updated.path).toBe(first.path);
			expect(harness.getContent(updated.path)).toContain('year: 2021');
			expect(harness.getContent(updated.path)).toContain('Added abstract later');
		});
	});

	describe('saveNote', () => {
		it('creates numbered fleeting notes with active source link, image embed, thoughts, and project-picker block', async () => {
			const activeLit = harness.addFile('Literature/Paper.md', '# Paper');
			harness.setActiveFile(activeLit);
			const imgFile = harness.addFile('img/shot.png', 'PNG');

			await service.saveNote(makeAnnotation(), 'create', undefined, imgFile);
			const firstPath = 'Fleeting/Annotation-author2020-anno1.md';
			const firstContent = harness.getContent(firstPath) ?? '';
			expect(firstContent).toContain('anno-key: anno1');
			expect(firstContent).toContain('cite-key: author2020');
			expect(firstContent).toContain('"[[Literature/Paper]]"');
			expect(firstContent).toContain('## Highlight');
			expect(firstContent).toContain('Important quote');
			expect(firstContent).toContain('![[img/shot.png]]');
			expect(firstContent).toContain('## Thoughts');
			expect(firstContent).toContain('My thought');
			expect(firstContent).toContain('## Source');
			expect(firstContent).toContain('```project-picker');

			// Second create picks next free numbered filename and links root-level active file by basename
			const rootPaper = harness.addFile('RootPaper.md', '# Root');
			harness.setActiveFile(rootPaper);
			await service.saveNote(
				makeAnnotation({ comment: '' }),
				'create',
				undefined,
				null
			);
			const secondPath = 'Fleeting/Annotation-author2020-anno1-1.md';
			const secondContent = harness.getContent(secondPath) ?? '';
			expect(secondContent).toContain('"[[RootPaper]]"');
			expect(secondContent).not.toContain('## Thoughts');
		});

		it('supports overwrite and append modes on existing fleeting notes and ignores missing targetFile', async () => {
			// Guard when targetFile is missing
			await service.saveNote(makeAnnotation(), 'overwrite');
			await service.saveNote(makeAnnotation(), 'append');
			expect(harness.files.size).toBe(0);

			await service.saveNote(
				makeAnnotation({ text: 'First quote', comment: 'First thought' }),
				'create'
			);
			const target = harness.getFile('Fleeting/Annotation-author2020-anno1.md')!;

			// Append preserves existing content and adds new quote
			await service.saveNote(
				makeAnnotation({ text: 'Appended quote', comment: '' }),
				'append',
				target
			);
			const appended = harness.getContent(target.path) ?? '';
			expect(appended).toContain('First quote');
			expect(appended).toContain('Appended quote');
			expect(getNoticeMessages()).toContain('Appended.');

			// Overwrite clears old Highlight & Thoughts sections before writing replacement
			const img = harness.addFile('img/new.png', 'PNG');
			await service.saveNote(
				makeAnnotation({ text: 'Replaced quote', comment: 'New thought' }),
				'overwrite',
				target,
				img
			);
			const overwritten = harness.getContent(target.path) ?? '';
			expect(overwritten).not.toContain('First quote');
			expect(overwritten).not.toContain('First thought');
			expect(overwritten).toContain('Replaced quote');
			expect(overwritten).toContain('New thought');
			expect(overwritten).toContain('![[img/new.png]]');
		});
	});

	describe('isAnnotationExported', () => {
		it('finds exported markdown note by annotationKeyName frontmatter or returns null', async () => {
			harness.addFile('Fleeting/other.md', '', { 'anno-key': 'other' });
			expect(await service.isAnnotationExported('key123')).toBeNull();

			const matchFile = harness.addFile('Fleeting/match.md', '', {
				'anno-key': 'key123',
			});
			expect(await service.isAnnotationExported('key123')).toBe(matchFile);
		});
	});

	describe('findLocalImage', () => {
		it('matches image by annotation key first, then by citationKey + page + rounded rect coordinates', () => {
			const byKey = harness.addFile('attachments/img-annoKey123.png', '');
			expect(service.findLocalImage(makeAnnotation({ key: 'annoKey123' }))).toBe(
				byKey
			);

			harness.addFile('attachments/other2021-p3-x10-y21.png', '');
			harness.addFile('attachments/author2020-p9-x10-y21.png', '');
			harness.addFile('attachments/author2020-p3-x99-y21.png', '');
			harness.addFile('attachments/author2020-p3-x10-y21.pdf', '');
			const coordMatch = harness.addFile(
				'attachments/author2020-p3-x10-y21.JPG',
				''
			);

			expect(
				service.findLocalImage(
					makeAnnotation({
						key: 'unmatchedKey',
						position: { pageIndex: 2, rects: [[10.4, 20.6, 50, 60]] },
					})
				)
			).toBe(coordMatch);

			const dashPageMatch = harness.addFile(
				'attachments/author2020-1-x5y7.jpeg',
				''
			);
			expect(
				service.findLocalImage(
					makeAnnotation({
						key: 'unmatchedKey2',
						position: { rects: [[5, 7, 9, 9]] },
					})
				)
			).toBe(dashPageMatch);
		});

		it('handles string, null, undefined, and empty-rects position boundaries safely by returning null', () => {
			harness.addFile('attachments/author2020-p1-x10-y20.png', '');

			expect(
				service.findLocalImage(
					makeAnnotation({
						key: 'noKeyMatch',
						position: '{"pageIndex":0,"rects":[[10,20,30,40]]}',
					})
				)
			).toBeNull();

			expect(
				service.findLocalImage(
					makeAnnotation({
						key: 'noKeyMatch',
						position: null,
					})
				)
			).toBeNull();

			expect(
				service.findLocalImage(
					makeAnnotation({
						key: 'noKeyMatch',
						position: undefined,
					})
				)
			).toBeNull();

			expect(
				service.findLocalImage(
					makeAnnotation({
						key: 'noKeyMatch',
						position: { pageIndex: 0, rects: [] },
					})
				)
			).toBeNull();
		});
	});
});
