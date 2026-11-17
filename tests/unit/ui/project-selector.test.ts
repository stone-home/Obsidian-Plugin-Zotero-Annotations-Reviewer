import { SuggestModal, TFile } from 'obsidian';
import ZoteroGKPlugin from '../../../src/main';
import { ProjectSelectorView } from '../../../src/ui/project-selector';
import { resetObsidianMocks } from '../../__mocks__/obsidian';
import { createTestPlugin } from '../../fixtures/plugin';
import {
	clearOpenedModals,
	createTestApp,
	getLastOpenedModal,
	getNoticeMessages,
	TestAppHarness,
} from '../../fixtures/vault';

describe('ProjectSelectorView and ProjectSuggestModal', () => {
	let harness: TestAppHarness;
	let plugin: ZoteroGKPlugin;

	beforeEach(() => {
		resetObsidianMocks();
		harness = createTestApp();
		plugin = createTestPlugin(harness, {
			projectsFolder: '004-Projects',
			projectFrontmatterKey: 'projects',
			projectIdKey: 'project_code',
		});
	});

	it('renders prompt message when no active file is open', async () => {
		const container = document.createElement('div');
		const view = new ProjectSelectorView(container, plugin);
		await view.onload();

		expect(container.textContent).toContain(
			'Please open a note to use the Project Linker.'
		);
	});

	it('renders empty state ("None") and scalar or array projects, opens links, and removes projects', async () => {
		const note = harness.addFile('002-Literature/paper.md', '---\ntitle: P\n---\n');
		harness.setActiveFile(note);

		const container = document.createElement('div');
		const view = new ProjectSelectorView(container, plugin);
		await view.onload();
		expect(container.textContent).toContain('Linked Projects:');
		expect(container.textContent).toContain('None');

		// Scalar project value in frontmatter
		harness.setFrontmatter(note.path, {
			projects: '[[004-Projects/Alpha/Dashboard|ALPHA]]',
		});
		view.render();

		const link = container.querySelector('.internal-link a') as HTMLAnchorElement;
		expect(link.textContent).toBe('ALPHA');
		link.click();
		expect(harness.openedLinks).toEqual([
			{
				linktext: '004-Projects/Alpha/Dashboard',
				sourcePath: '002-Literature/paper.md',
			},
		]);

		// Array of projects + remove button
		harness.setFrontmatter(note.path, {
			projects: [
				'[[004-Projects/Alpha/Dashboard|ALPHA]]',
				'[[004-Projects/Beta/Dashboard]]',
			],
		});
		view.render();

		const removeBtns = Array.from(
			container.querySelectorAll('.project-remove-btn')
		) as HTMLElement[];
		expect(removeBtns).toHaveLength(2);
		expect(removeBtns[0].textContent).toBe('×');

		removeBtns[0].click();
		await Promise.resolve();
		await Promise.resolve();

		expect(harness.getFrontmatter(note.path)?.projects).toEqual([
			'[[004-Projects/Beta/Dashboard]]',
		]);
		expect(getNoticeMessages()).toContain(
			'Removed project: [[004-Projects/Alpha/Dashboard|ALPHA]]'
		);
	});

	it('filters ProjectSuggestModal to one-level Dashboard.md files, formats aliases, prevents duplicates, and handles frontmatter errors', async () => {
		const note = harness.addFile('002-Literature/paper.md', '---\ntitle: P\n---\n');
		harness.setActiveFile(note);

		const dashAlpha = harness.addFile(
			'004-Projects/Alpha/Dashboard.md',
			'---\nproject_name: Alpha Engine\nproject_code: P-ALPHA\n---\n'
		);
		const dashBeta = harness.addFile(
			'004-Projects/Beta/Dashboard.md',
			'---\ntitle: Beta Runtime\n---\n'
		);
		const dashGamma = harness.addFile(
			'004-Projects/GammaFolder/Dashboard.md',
			'# Gamma'
		);
		// Excluded files: wrong depth, wrong filename, wrong folder
		harness.addFile('004-Projects/Dashboard.md', '# Root dashboard');
		harness.addFile('004-Projects/Alpha/Sub/Dashboard.md', '# Nested');
		harness.addFile('004-Projects/Alpha/Notes.md', '# Not dashboard');
		harness.addFile('OtherFolder/Delta/Dashboard.md', '# Wrong base');

		const container = document.createElement('div');
		const view = new ProjectSelectorView(container, plugin);
		view.render();

		clearOpenedModals();
		const addBtn = container.querySelector('button') as HTMLButtonElement;
		expect(addBtn.textContent).toBe('Add Project');
		addBtn.click();

		const suggestModal = getLastOpenedModal() as SuggestModal<TFile> | undefined;
		expect(suggestModal).toBeDefined();

		const allDashboards = suggestModal!.getSuggestions('');
		expect(allDashboards).toEqual([dashAlpha, dashBeta, dashGamma]);
		expect(suggestModal!.getSuggestions('runtime')).toEqual([dashBeta]);
		expect(suggestModal!.getSuggestions('gammafolder')).toEqual([dashGamma]);

		const renderedEl = document.createElement('div');
		suggestModal!.renderSuggestion(dashAlpha, renderedEl);
		expect(renderedEl.textContent).toBe('Alpha Engine');

		// Choose dashAlpha (uses project_code alias)
		suggestModal!.onChooseSuggestion(dashAlpha, new MouseEvent('click'));
		await Promise.resolve();
		await Promise.resolve();
		expect(harness.getFrontmatter(note.path)?.projects).toEqual([
			'[[004-Projects/Alpha/Dashboard|P-ALPHA]]',
		]);
		expect(getNoticeMessages()).toContain('Added project: Dashboard');

		// Choose dashAlpha again -> duplicate notice
		await view.addProject(note, dashAlpha);
		expect(getNoticeMessages()).toContain('Project already linked.');

		// Choose dashGamma (no project_code -> plain path wikilink)
		await view.addProject(note, dashGamma);
		expect(harness.getFrontmatter(note.path)?.projects).toEqual([
			'[[004-Projects/Alpha/Dashboard|P-ALPHA]]',
			'[[004-Projects/GammaFolder/Dashboard]]',
		]);

		// Error handling in addProject and removeProject
		harness.mockApp.fileManager.processFrontMatter.mockRejectedValueOnce(
			new Error('YAML write locked')
		);
		await view.addProject(note, dashBeta);
		expect(
			getNoticeMessages().some((m) => m.includes('Failed to update frontmatter:'))
		).toBe(true);

		harness.mockApp.fileManager.processFrontMatter.mockRejectedValueOnce(
			new Error('YAML remove locked')
		);
		await view.removeProject(note, '[[004-Projects/GammaFolder/Dashboard]]');
		expect(
			getNoticeMessages().some((m) => m.includes('Failed to remove project:'))
		).toBe(true);
	});
});
