import yaml from 'js-yaml';
import type {
	App as ObsidianApp,
	MarkdownPostProcessorContext as ObsidianPostProcessorContext,
	PluginManifest as ObsidianPluginManifest,
	TFile as ObsidianTFile,
	TFolder as ObsidianTFolder,
} from 'obsidian';
import {
	App as MockApp,
	ItemView as MockItemView,
	MarkdownRenderChild,
	Plugin as MockPlugin,
	TAbstractFile as MockTAbstractFile,
	TFile as MockTFile,
	TFolder as MockTFolder,
	WorkspaceLeaf as MockWorkspaceLeaf,
	clearNotices,
	clearOpenedMenus,
	clearOpenedModals,
	getLastOpenedModal,
	getNoticeMessages,
	getOpenedMenus,
	getOpenedModals,
	normalizePath,
	resetObsidianMocks,
} from '../__mocks__/obsidian';

export {
	clearNotices,
	clearOpenedMenus,
	clearOpenedModals,
	getLastOpenedModal,
	getNoticeMessages,
	getOpenedMenus,
	getOpenedModals,
	resetObsidianMocks,
};

function normalizeYamlValue(val: unknown): unknown {
	if (val instanceof Date && !isNaN(val.getTime())) {
		return val.toISOString().slice(0, 10);
	}
	if (Array.isArray(val)) {
		return val.map(normalizeYamlValue);
	}
	if (val !== null && typeof val === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
			out[k] = normalizeYamlValue(v);
		}
		return out;
	}
	return val;
}

export function extractFrontmatterFromMarkdown(
	markdown: string
): Record<string, unknown> | null {
	const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) return null;
	try {
		const parsed = yaml.load(match[1]);
		if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return normalizeYamlValue(parsed) as Record<string, unknown>;
		}
		return {};
	} catch {
		return null;
	}
}

function replaceFrontmatterInMarkdown(
	markdown: string,
	fm: Record<string, unknown>
): string {
	const dumped = yaml.dump(fm, { lineWidth: -1 }).trimEnd();
	const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n?[\s\S]*)$/);
	if (match) {
		return `---\n${dumped}\n---${match[2]}`;
	}
	return markdown ? `---\n${dumped}\n---\n\n${markdown}` : `---\n${dumped}\n---\n`;
}

export interface TestAppOptions {
	autoLayoutReady?: boolean;
	manifestDir?: string;
}

export interface TestAppHarness {
	app: ObsidianApp;
	mockApp: MockApp;
	manifest: ObsidianPluginManifest;
	files: Map<string, { file: MockTFile; content: string }>;
	folders: Map<string, MockTFolder>;
	frontmatters: Map<string, Record<string, unknown>>;
	disk: Map<string, string>;
	diskFolders: Set<string>;
	openedFiles: ObsidianTFile[];
	openedLinks: Array<{ linktext: string; sourcePath: string }>;
	addFile(
		path: string,
		content?: string,
		frontmatter?: Record<string, unknown>,
		mtime?: number
	): ObsidianTFile;
	addFolder(path: string): ObsidianTFolder;
	getFile(path: string): ObsidianTFile | null;
	getContent(path: string): string | undefined;
	setContent(path: string, content: string): void;
	getFrontmatter(path: string): Record<string, unknown> | undefined;
	setFrontmatter(path: string, fm: Record<string, unknown>): void;
	setActiveFile(file: ObsidianTFile | null): void;
	registerPlugin(id: string, pluginInstance: unknown): void;
	registerCommand(id: string, callback?: () => unknown): void;
	setSecret(id: string, secret: string): void;
	attachPluginViews(plugin: unknown): void;
	triggerLayoutReady(): Promise<void>;
	createPostProcessorContext(
		sourcePath: string,
		frontmatter?: Record<string, unknown> | null
	): ObsidianPostProcessorContext;
}

export function makeVaultFile(path: string, mtime = 1000, size = 128): ObsidianTFile {
	const normalized = normalizePath(path);
	const file = new MockTFile(normalized, mtime, size);
	const parts = normalized.split('/');
	if (parts.length > 1) {
		const parentPath = parts.slice(0, -1).join('/');
		file.parent = new MockTFolder(parentPath);
	}
	return file as unknown as ObsidianTFile;
}

export function createTestApp(options: TestAppOptions = {}): TestAppHarness {
	const autoLayoutReady = options.autoLayoutReady ?? false;
	const mockApp = new MockApp();
	const app = mockApp as unknown as ObsidianApp;

	const files = new Map<string, { file: MockTFile; content: string }>();
	const folders = new Map<string, MockTFolder>();
	const frontmatters = new Map<string, Record<string, unknown>>();
	const disk = new Map<string, string>();
	const diskFolders = new Set<string>();
	const openedFiles: ObsidianTFile[] = [];
	const openedLinks: Array<{ linktext: string; sourcePath: string }> = [];
	const pluginsRegistry = new Map<string, unknown>();
	const layoutCallbacks: Array<() => unknown> = [];
	const viewFactories = new Map<string, (leaf: MockWorkspaceLeaf) => MockItemView>();
	const leavesByType = new Map<string, MockWorkspaceLeaf[]>();

	let activeFile: ObsidianTFile | null = null;

	const rootFolder = new MockTFolder('');
	folders.set('', rootFolder);

	const ensureFolderChain = (folderPath: string): MockTFolder => {
		const clean = normalizePath(folderPath).replace(/\/+$/, '');
		if (!clean) return rootFolder;
		const existing = folders.get(clean);
		if (existing) return existing;

		const segments = clean.split('/').filter(Boolean);
		let currentPath = '';
		let parentFolder = rootFolder;
		for (const seg of segments) {
			currentPath = currentPath ? `${currentPath}/${seg}` : seg;
			let folder = folders.get(currentPath);
			if (!folder) {
				folder = new MockTFolder(currentPath);
				folder.vault = mockApp.vault;
				folder.parent = parentFolder;
				if (!parentFolder.children.includes(folder)) {
					parentFolder.children.push(folder);
				}
				folders.set(currentPath, folder);
				diskFolders.add(currentPath);
			}
			parentFolder = folder;
		}
		return parentFolder;
	};

	const syncParentFolder = (file: MockTFile): void => {
		const slashIdx = file.path.lastIndexOf('/');
		const parentPath = slashIdx >= 0 ? file.path.slice(0, slashIdx) : '';
		const parentFolder = ensureFolderChain(parentPath);
		file.parent = parentFolder;
		if (!parentFolder.children.includes(file)) {
			parentFolder.children.push(file);
		}
	};

	const addFile = (
		rawPath: string,
		content = '',
		frontmatter?: Record<string, unknown>,
		mtime = 1000
	): ObsidianTFile => {
		const path = normalizePath(rawPath);
		const file = new MockTFile(path, mtime, content.length);
		file.vault = mockApp.vault;
		syncParentFolder(file);
		files.set(path, { file, content });
		disk.set(path, content);

		const parsedFm = extractFrontmatterFromMarkdown(content);
		if (frontmatter !== undefined) {
			frontmatters.set(path, { ...(parsedFm ?? {}), ...frontmatter });
		} else if (parsedFm !== null) {
			frontmatters.set(path, parsedFm);
		}
		return file as unknown as ObsidianTFile;
	};

	const addFolder = (rawPath: string): ObsidianTFolder => {
		const folder = ensureFolderChain(rawPath);
		return folder as unknown as ObsidianTFolder;
	};

	mockApp.vault.getAbstractFileByPath.mockImplementation(
		(rawPath: string): MockTAbstractFile | null => {
			const p = normalizePath(rawPath).replace(/\/+$/, '');
			const fileEntry = files.get(p);
			if (fileEntry) return fileEntry.file;
			const folderEntry = folders.get(p);
			if (folderEntry && p !== '') return folderEntry;
			return null;
		}
	);

	mockApp.vault.createFolder.mockImplementation(
		async (rawPath: string): Promise<MockTFolder> => {
			const clean = normalizePath(rawPath).replace(/\/+$/, '');
			if (clean && folders.has(clean)) {
				throw new Error('Folder already exists.');
			}
			return ensureFolderChain(clean);
		}
	);

	mockApp.vault.create.mockImplementation(
		async (rawPath: string, content: string): Promise<MockTFile> => {
			const path = normalizePath(rawPath);
			if (files.has(path)) {
				throw new Error('File already exists.');
			}
			const created = addFile(path, content) as unknown as MockTFile;
			mockApp.vault.trigger('create', created);
			mockApp.metadataCache.trigger('changed', created);
			return created;
		}
	);

	mockApp.vault.read.mockImplementation(async (file: MockTFile): Promise<string> => {
		const path = normalizePath(file.path);
		const entry = files.get(path);
		if (!entry) {
			throw new Error(`File not found: ${path}`);
		}
		return entry.content;
	});

	mockApp.vault.cachedRead.mockImplementation(async (file: MockTFile) =>
		mockApp.vault.read(file)
	);

	mockApp.vault.modify.mockImplementation(
		async (file: MockTFile, content: string): Promise<void> => {
			const path = normalizePath(file.path);
			const existing = files.get(path);
			if (existing) {
				existing.content = content;
				existing.file.stat.size = content.length;
			} else {
				files.set(path, { file, content });
			}
			disk.set(path, content);
			const parsedFm = extractFrontmatterFromMarkdown(content);
			if (parsedFm !== null) {
				frontmatters.set(path, parsedFm);
			}
			mockApp.vault.trigger('modify', file);
			mockApp.metadataCache.trigger('changed', file);
		}
	);

	const removeVaultItem = async (target: MockTAbstractFile): Promise<void> => {
		const path = normalizePath(target.path);
		files.delete(path);
		frontmatters.delete(path);
		disk.delete(path);
		mockApp.vault.trigger('delete', target);
	};

	mockApp.vault.delete.mockImplementation(async (target: MockTAbstractFile) => {
		await removeVaultItem(target);
	});

	mockApp.vault.trash.mockImplementation(async (target: MockTAbstractFile) => {
		await removeVaultItem(target);
	});

	mockApp.vault.rename.mockImplementation(
		async (target: MockTAbstractFile, newRawPath: string): Promise<void> => {
			await mockApp.fileManager.renameFile(target, newRawPath);
		}
	);

	mockApp.vault.getMarkdownFiles.mockImplementation((): MockTFile[] =>
		Array.from(files.values())
			.map((e) => e.file)
			.filter((f) => f.extension.toLowerCase() === 'md')
	);

	mockApp.vault.getFiles.mockImplementation((): MockTFile[] =>
		Array.from(files.values()).map((e) => e.file)
	);

	mockApp.vault.adapter.exists.mockImplementation(async (rawPath: string) => {
		const p = normalizePath(rawPath).replace(/\/+$/, '');
		return (
			disk.has(p) ||
			diskFolders.has(p) ||
			files.has(p) ||
			(p !== '' && folders.has(p)) ||
			Array.from(disk.keys()).some((k) => k.startsWith(`${p}/`))
		);
	});

	mockApp.vault.adapter.read.mockImplementation(async (rawPath: string) => {
		const p = normalizePath(rawPath);
		if (disk.has(p)) return disk.get(p) ?? '';
		const vf = files.get(p);
		if (vf) return vf.content;
		throw new Error(`Adapter file not found: ${p}`);
	});

	mockApp.vault.adapter.write.mockImplementation(
		async (rawPath: string, data: string) => {
			const p = normalizePath(rawPath);
			disk.set(p, data);
			const vf = files.get(p);
			if (vf) {
				vf.content = data;
			}
		}
	);

	mockApp.vault.adapter.remove.mockImplementation(async (rawPath: string) => {
		const p = normalizePath(rawPath);
		disk.delete(p);
		files.delete(p);
		frontmatters.delete(p);
	});

	mockApp.vault.adapter.list.mockImplementation(async (rawFolder: string) => {
		const prefix = normalizePath(rawFolder).replace(/\/+$/, '');
		const dirPrefix = prefix ? `${prefix}/` : '';
		const matchedFiles = Array.from(disk.keys()).filter((k) => {
			if (!k.startsWith(dirPrefix)) return false;
			const rest = k.slice(dirPrefix.length);
			return rest.length > 0 && !rest.includes('/');
		});
		return { files: matchedFiles, folders: [] };
	});

	mockApp.vault.adapter.mkdir.mockImplementation(async (rawFolder: string) => {
		const p = normalizePath(rawFolder).replace(/\/+$/, '');
		if (p) {
			diskFolders.add(p);
			ensureFolderChain(p);
		}
	});

	mockApp.metadataCache.getFileCache.mockImplementation((file: MockTFile) => {
		const path = normalizePath(file.path);
		const fm = frontmatters.get(path);
		if (fm) return { frontmatter: fm };
		const entry = files.get(path);
		if (entry) {
			const parsed = extractFrontmatterFromMarkdown(entry.content);
			if (parsed) {
				frontmatters.set(path, parsed);
				return { frontmatter: parsed };
			}
		}
		return null;
	});

	mockApp.metadataCache.getFirstLinkpathDest.mockImplementation(
		(linkpath: string, _sourcePath: string): MockTFile | null => {
			const clean = normalizePath(linkpath.split('#')[0].trim());
			if (!clean) return null;
			const withMd = clean.toLowerCase().endsWith('.md') ? clean : `${clean}.md`;
			const direct = files.get(withMd) ?? files.get(clean);
			if (direct) return direct.file;
			const targetBase = (clean.split('/').pop() ?? clean)
				.replace(/\.md$/i, '')
				.toLowerCase();
			for (const entry of files.values()) {
				if (entry.file.basename.toLowerCase() === targetBase) {
					return entry.file;
				}
			}
			return null;
		}
	);

	mockApp.fileManager.processFrontMatter.mockImplementation(
		async (
			file: MockTFile,
			fn: (frontmatter: Record<string, unknown>) => void
		): Promise<void> => {
			const path = normalizePath(file.path);
			const entry = files.get(path);
			const existingFm =
				frontmatters.get(path) ??
				(entry ? extractFrontmatterFromMarkdown(entry.content) : null) ??
				{};
			const mutableFm: Record<string, unknown> = { ...existingFm };
			fn(mutableFm);
			frontmatters.set(path, mutableFm);
			if (entry) {
				entry.content = replaceFrontmatterInMarkdown(entry.content, mutableFm);
				disk.set(path, entry.content);
			}
			mockApp.vault.trigger('modify', file);
			mockApp.metadataCache.trigger('changed', file);
		}
	);

	mockApp.fileManager.renameFile.mockImplementation(
		async (target: MockTAbstractFile, newRawPath: string): Promise<void> => {
			const oldPath = normalizePath(target.path);
			const newPath = normalizePath(newRawPath);
			const entry = files.get(oldPath);
			if (!entry) {
				throw new Error(`Source file not found: ${oldPath}`);
			}
			files.delete(oldPath);
			disk.delete(oldPath);
			const fm = frontmatters.get(oldPath);
			frontmatters.delete(oldPath);

			const updatedFile = entry.file;
			updatedFile.path = newPath;
			updatedFile.name = newPath.split('/').pop() ?? newPath;
			const dotIdx = updatedFile.name.lastIndexOf('.');
			if (dotIdx > 0) {
				updatedFile.basename = updatedFile.name.slice(0, dotIdx);
				updatedFile.extension = updatedFile.name.slice(dotIdx + 1);
			} else {
				updatedFile.basename = updatedFile.name;
			}
			syncParentFolder(updatedFile);

			files.set(newPath, { file: updatedFile, content: entry.content });
			disk.set(newPath, entry.content);
			if (fm) frontmatters.set(newPath, fm);
		}
	);

	const createBoundLeaf = (): MockWorkspaceLeaf => {
		const leaf = new MockWorkspaceLeaf();
		leaf.openFile.mockImplementation(async (file: MockTFile) => {
			const obsFile = file as unknown as ObsidianTFile;
			openedFiles.push(obsFile);
			activeFile = obsFile;
		});
		leaf.setViewState.mockImplementation(async (state) => {
			const creator = viewFactories.get(state.type);
			if (creator) {
				const view = creator(leaf);
				view.app = mockApp;
				leaf.view = view;
				const bucket = leavesByType.get(state.type) ?? [];
				if (!bucket.includes(leaf)) {
					bucket.push(leaf);
					leavesByType.set(state.type, bucket);
				}
				await view.onOpen();
			}
		});
		return leaf;
	};

	const mainLeaf = createBoundLeaf();
	mockApp.workspace.getLeaf.mockImplementation(() => mainLeaf);
	mockApp.workspace.getActiveFile.mockImplementation(
		() => activeFile as unknown as MockTFile | null
	);
	mockApp.workspace.openLinkText.mockImplementation(
		async (linktext: string, sourcePath: string) => {
			openedLinks.push({ linktext, sourcePath });
		}
	);
	mockApp.workspace.openPopoutLeaf.mockImplementation(() => createBoundLeaf());
	mockApp.workspace.getLeavesOfType.mockImplementation(
		(type: string) => leavesByType.get(type) ?? []
	);
	mockApp.workspace.onLayoutReady.mockImplementation((cb: () => unknown) => {
		if (autoLayoutReady) {
			cb();
		} else {
			layoutCallbacks.push(cb);
		}
	});

	mockApp.plugins.getPlugin.mockImplementation(
		(id: string) => pluginsRegistry.get(id) ?? null
	);
	mockApp.commands.executeCommandById.mockImplementation((id: string) => {
		const cmd = mockApp.commands.commands[id];
		if (!cmd) return false;
		cmd.callback?.();
		return true;
	});
	mockApp.setting = {
		close: jest.fn(),
	};

	const manifest: ObsidianPluginManifest = {
		id: 'zotero-annotation-reviewer',
		name: 'Zotero Annotation Reviewer',
		author: 'stone',
		version: '1.9.0',
		minAppVersion: '1.0.0',
		description: 'Test manifest',
		dir: options.manifestDir ?? 'plugin',
	};

	return {
		app,
		mockApp,
		manifest,
		files,
		folders,
		frontmatters,
		disk,
		diskFolders,
		openedFiles,
		openedLinks,
		addFile,
		addFolder,
		getFile(rawPath: string): ObsidianTFile | null {
			const entry = files.get(normalizePath(rawPath));
			return entry ? (entry.file as unknown as ObsidianTFile) : null;
		},
		getContent(rawPath: string): string | undefined {
			return files.get(normalizePath(rawPath))?.content;
		},
		setContent(rawPath: string, content: string): void {
			const p = normalizePath(rawPath);
			const entry = files.get(p);
			if (entry) {
				entry.content = content;
				disk.set(p, content);
				const parsed = extractFrontmatterFromMarkdown(content);
				if (parsed !== null) frontmatters.set(p, parsed);
			} else {
				addFile(p, content);
			}
		},
		getFrontmatter(rawPath: string): Record<string, unknown> | undefined {
			return frontmatters.get(normalizePath(rawPath));
		},
		setFrontmatter(rawPath: string, fm: Record<string, unknown>): void {
			frontmatters.set(normalizePath(rawPath), fm);
		},
		setActiveFile(file: ObsidianTFile | null): void {
			activeFile = file;
		},
		registerPlugin(id: string, pluginInstance: unknown): void {
			pluginsRegistry.set(id, pluginInstance);
		},
		registerCommand(id: string, callback?: () => unknown): void {
			mockApp.commands.commands[id] = {
				id,
				name: id,
				callback,
			};
		},
		setSecret(id: string, secret: string): void {
			mockApp.secretStorage.setSecret(id, secret);
		},
		attachPluginViews(plugin: unknown): void {
			const mockPlugin = plugin as MockPlugin;
			for (const [type, creator] of mockPlugin.views.entries()) {
				viewFactories.set(type, creator);
			}
			const origRegisterView = mockPlugin.registerView;
			mockPlugin.registerView = jest.fn(
				(type: string, creator: (leaf: MockWorkspaceLeaf) => MockItemView) => {
					origRegisterView(type, creator);
					viewFactories.set(type, creator);
				}
			);
		},
		async triggerLayoutReady(): Promise<void> {
			while (layoutCallbacks.length > 0) {
				const cb = layoutCallbacks.shift();
				await cb?.();
			}
		},
		createPostProcessorContext(
			sourcePath: string,
			frontmatter?: Record<string, unknown> | null
		): ObsidianPostProcessorContext {
			const resolvedFm =
				frontmatter !== undefined
					? frontmatter
					: (frontmatters.get(normalizePath(sourcePath)) ?? null);
			return {
				docId: 'doc-test-1',
				sourcePath: normalizePath(sourcePath),
				frontmatter: resolvedFm,
				addChild(child: unknown): void {
					(child as MarkdownRenderChild).load();
				},
				getSectionInfo(): null {
					return null;
				},
			};
		},
	};
}
