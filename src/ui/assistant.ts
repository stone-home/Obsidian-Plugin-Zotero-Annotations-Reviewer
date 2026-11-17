import {
	App,
	ButtonComponent,
	ExtraButtonComponent,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	Modal,
	Notice,
	setIcon,
	SuggestModal,
	TextComponent,
	TFile,
} from 'obsidian';
import type ZoteroGKPlugin from '../main';
import { FleetingNoteSummary, PaperState } from '../services/paper-hub';
import { normalizeVenueSeries } from '../services/vault-library';
import { ZoteroConnectorService } from '../services/zotero-connector';
import { WebhookInputVariable, WebhookProfile } from '../types';
import { parseImageMap } from '../utils/parser';
import { normalizePath } from '../utils/paths';
import {
	ConnectorModal,
	renderMarkdownContent,
	VaultMarkdownSuggestModal,
} from './connector-modal';
import { HighlightModal } from './highlights';

function addIconAction(
	parent: HTMLElement,
	icon: string,
	tooltip: string,
	onClick: () => void | Promise<void>,
	extraCls?: string
): HTMLElement {
	if (typeof ExtraButtonComponent === 'function') {
		const btn = new ExtraButtonComponent(parent)
			.setIcon(icon)
			.setTooltip(tooltip)
			.onClick(() => {
				void onClick();
			});
		if (extraCls) btn.extraSettingsEl.addClass(extraCls);
		return btn.extraSettingsEl;
	}
	const fallback = parent.createEl('button', {
		cls: `clickable-icon extra-setting-button${extraCls ? ` ${extraCls}` : ''}`,
		attr: { 'aria-label': tooltip, title: tooltip, type: 'button' },
	});
	setIcon(fallback, icon);
	fallback.onclick = () => {
		void onClick();
	};
	return fallback;
}

function getFileBasename(file: TFile): string {
	if (file.basename) return file.basename;
	return (file.name || file.path.split('/').pop() || '').replace(/\.md$/i, '');
}

function parseWikiDisplay(rawLink: string): { linkPath: string; label: string } {
	const inner = rawLink.replace(/^\[\[|\]\]$/g, '').trim();
	const [target, alias] = inner.split('|');
	const linkPath = (target || inner).trim();
	const shortTarget = linkPath.split('/').pop() || linkPath;
	return {
		linkPath,
		label: (alias || shortTarget).trim(),
	};
}

class AssistantProjectSuggestModal extends SuggestModal<TFile> {
	constructor(
		app: App,
		private readonly projectFolder: string,
		private readonly onChoose: (file: TFile) => void
	) {
		super(app);
		this.setPlaceholder?.('Select a project to link...');
	}

	private isDashboard(file: TFile): boolean {
		const base = normalizePath(this.projectFolder).replace(/\/+$/, '') + '/';
		if (!normalizePath(file.path).startsWith(base)) return false;
		if (!file.path.toLowerCase().endsWith('.md')) return false;
		const rest = normalizePath(file.path).slice(base.length);
		const parts = rest.split('/');
		return parts.length === 2 && parts[1] === 'Dashboard.md';
	}

	private getDisplayName(file: TFile): string {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		const fromFm = (fm?.['project_name'] ?? fm?.['title'])?.toString?.()?.trim();
		if (fromFm) return fromFm;
		const parts = normalizePath(file.path).split('/');
		if (getFileBasename(file) === 'Dashboard' && parts.length >= 2) {
			return parts[parts.length - 2];
		}
		return getFileBasename(file);
	}

	getSuggestions(query: string): TFile[] {
		const q = query.toLowerCase();
		const allFiles = this.app.vault.getMarkdownFiles();
		const dashboards = allFiles.filter((f) => this.isDashboard(f));
		const base = normalizePath(this.projectFolder).replace(/\/+$/, '') + '/';
		const pool =
			dashboards.length > 0
				? dashboards
				: allFiles.filter((f) => normalizePath(f.path).startsWith(base));

		return pool.filter((f) => {
			const label = this.getDisplayName(f).toLowerCase();
			return label.includes(q) || f.path.toLowerCase().includes(q);
		});
	}

	renderSuggestion(file: TFile, el: HTMLElement): void {
		el.createDiv({ text: this.getDisplayName(file) });
		el.createDiv({ text: file.path, cls: 'zotero-text-muted-italic' });
	}

	onChooseSuggestion(file: TFile): void {
		this.onChoose(file);
	}
}

class AssistantWebhookInputModal extends Modal {
	private inputs = new Map<string, TextComponent>();

	constructor(
		app: App,
		private readonly hookName: string,
		private readonly variables: WebhookInputVariable[],
		private readonly onSubmit: (values: Record<string, string>) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('zotero-webhook-input-modal');
		contentEl.createEl('h3', { text: this.hookName, cls: 'zotero-webhook-input-title' });
		const form = contentEl.createDiv({ cls: 'zotero-webhook-input-form' });

		for (const iv of this.variables) {
			const row = form.createDiv({ cls: 'zotero-webhook-input-row' });
			row.createEl('label', {
				text: `{{${iv.name}}}`,
				cls: 'zotero-webhook-input-label',
			});
			const tc = new TextComponent(row);
			tc.inputEl.addClass('zotero-webhook-input-field');
			if (iv.type === 'number') {
				tc.inputEl.type = 'number';
				tc.setPlaceholder('0');
			} else {
				tc.setPlaceholder('Value...');
			}
			this.inputs.set(iv.name, tc);
		}

		const footer = contentEl.createDiv({ cls: 'zotero-webhook-input-footer' });
		new ButtonComponent(footer).setButtonText('Cancel').onClick(() => this.close());
		new ButtonComponent(footer)
			.setButtonText('Trigger')
			.setCta()
			.onClick(() => {
				const values: Record<string, string> = {};
				for (const iv of this.variables) {
					const raw = this.inputs.get(iv.name)?.getValue() ?? '';
					values[iv.name] = iv.type === 'number' ? String(Number(raw)) : raw;
				}
				this.close();
				this.onSubmit(values);
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

const MAX_INLINE_VENUE_PAPERS = 3;

class CodeUrlModal extends Modal {
	constructor(
		app: App,
		private readonly initialUrl: string,
		private readonly onSave: (url: string) => void | Promise<void>
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('zotero-webhook-input-modal');
		contentEl.createEl('h3', {
			text: 'Repository URL',
			cls: 'zotero-webhook-input-title',
		});
		contentEl.createDiv({
			cls: 'zotero-webhook-input-desc',
			text: 'Set or update the code repository URL in this literature note frontmatter.',
		});

		const form = contentEl.createDiv({ cls: 'zotero-webhook-input-form' });
		const row = form.createDiv({ cls: 'zotero-webhook-input-row' });
		const inputEl = row.createEl('input', {
			cls: 'zotero-webhook-input-field',
			attr: {
				type: 'text',
				placeholder: 'https://github.com/...',
			},
		}) as HTMLInputElement;
		inputEl.value = this.initialUrl;

		const submitSave = async () => {
			const raw = inputEl.value.trim();
			if (!raw) {
				await this.onSave('');
				this.close();
				return;
			}
			const candidate =
				!/^https?:\/\//i.test(raw) && !/^[a-z]+:/i.test(raw) && raw.includes('.')
					? `https://${raw}`
					: raw;
			if (!/^https?:\/\/\S+$/i.test(candidate)) {
				new Notice('Please enter a valid http(s) repository URL.');
				return;
			}
			await this.onSave(candidate);
			this.close();
		};

		inputEl.onkeydown = (ev) => {
			if (ev.key === 'Enter') {
				ev.preventDefault();
				void submitSave();
			}
		};

		const footer = contentEl.createDiv({ cls: 'zotero-webhook-input-footer' });
		const clearBtn = footer.createEl('button', {
			text: 'Clear',
			attr: { type: 'button' },
		});
		clearBtn.onclick = async () => {
			await this.onSave('');
			this.close();
		};

		const cancelBtn = footer.createEl('button', {
			text: 'Cancel',
			attr: { type: 'button' },
		});
		cancelBtn.onclick = () => this.close();

		const saveBtn = footer.createEl('button', {
			cls: 'mod-cta',
			text: 'Save',
			attr: { type: 'button' },
		});
		saveBtn.onclick = () => {
			void submitSave();
		};
		setTimeout(() => inputEl.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class AssistantView extends MarkdownRenderChild {
	plugin: ZoteroGKPlugin;
	private zoteroConnector: ZoteroConnectorService;

	constructor(containerEl: HTMLElement, plugin: ZoteroGKPlugin) {
		super(containerEl);
		this.plugin = plugin;
		this.zoteroConnector = new ZoteroConnectorService(this.plugin.app, this.plugin.settings);
	}

	async render(source: string, ctx: MarkdownPostProcessorContext): Promise<void> {
		const el = this.containerEl;
		el.empty();

		const file = this.plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!(file instanceof TFile)) {
			el.createDiv({ text: 'Assistant only works in notes.' });
			return;
		}

		const imageMap = parseImageMap(source);
		const container = el.createDiv({ cls: 'zotero-assistant-container' });
		const rerender = async () => {
			await this.render(source, ctx);
		};

		const state = await this.plugin.paperHub.getPaperState(file);
		if (!state) {
			container.createDiv({
				cls: 'zotero-assistant-empty-key',
				text: `No citation key found (${this.plugin.settings.citationKeyName || 'citation-key'}).`,
			});
			if (this.plugin.settings.enableLegacyAssistantScript) {
				const legacyWrap = container.createDiv({ cls: 'zotero-local-highlights' });
				await this.renderLegacyScript(file, legacyWrap, source);
			}
			return;
		}

		// 1. Two-Row Header (Row 1: Actions & Webhooks; Row 2: Files & External Links)
		this.renderTopBar(container, file, state, imageMap, rerender);

		// 2. Core Note Click-to-Edit Block
		await this.renderCoreNoteBlock(container, file, state, rerender);

		// 3. Unified Projects & Linked Notes Row
		this.renderProjectsAndLinksBar(container, file, state, rerender);

		// 4. Inline Highlight Notes / Comments (ONLY when fleetingNotes.length > 0)
		if (state.fleetingNotes.length > 0) {
			await this.renderInlineCommentsSection(container, state.fleetingNotes, rerender);
		}

		if (this.plugin.settings.enableLegacyAssistantScript) {
			const legacyWrap = container.createDiv({ cls: 'zotero-local-highlights' });
			await this.renderLegacyScript(file, legacyWrap, source);
		}

		// 5. Compact CFP & Same-Venue Vault Papers Footer Bar
		this.renderVenueAndCfpBar(container, file);
	}

	private renderTopBar(
		container: HTMLElement,
		file: TFile,
		state: PaperState,
		imageMap: Record<string, string>,
		rerender: () => Promise<void>
	): void {
		const topbar = container.createDiv({ cls: 'zotero-assistant-topbar' });

		// Row 1: Left-Aligned Action Toolbar & Webhooks
		const toolbarRow = topbar.createDiv({ cls: 'zotero-assistant-toolbar-row' });
		const toolbar = toolbarRow.createDiv({ cls: 'zotero-assistant-toolbar' });

		addIconAction(toolbar, 'refresh-cw', 'Refresh metadata from Zotero', () =>
			this.zoteroConnector.triggerZoteroIntegrationImport(state.citekey)
		);

		addIconAction(toolbar, 'highlighter', 'Review PDF highlights', () => {
			new HighlightModal(
				this.plugin.app,
				this.plugin.settings,
				state.citekey,
				imageMap,
				rerender
			).open();
		});

		const hasCandidates = state.takeawayCandidates.length > 0;
		addIconAction(
			toolbar,
			'link-2',
			'Connect paper to vault',
			() => {
				new ConnectorModal(this.plugin.app, this.plugin, file, rerender).open();
			},
			hasCandidates ? 'has-badge' : undefined
		);

		const visibleHooks = (this.plugin.settings.webhooks || []).filter((h) => !h.hidden);
		if (visibleHooks.length > 0) {
			toolbar.createSpan({ cls: 'zotero-assistant-toolbar-divider' });
			for (const hook of visibleHooks) {
				const hookBtn = toolbar.createEl('button', {
					cls: 'zotero-webhook-pill',
					attr: {
						type: 'button',
						title: `Trigger: ${hook.name}`,
						'aria-label': `Trigger: ${hook.name}`,
					},
				});
				const iconSpan = hookBtn.createSpan({ cls: 'zotero-res-pill-icon' });
				setIcon(iconSpan, hook.icon || 'send');
				hookBtn.createSpan({ text: hook.name });
				hookBtn.onclick = () => this.triggerWebhookFromToolbar(hook, file);
			}
		}

		// Row 2: Companion Files + External Links + Code Repository Pill
		const ws = this.plugin.settings.paperWorkspace;
		const takeawayLabel = ws?.takeawayLabel?.trim() || 'Takeaway';
		const report1Label = ws?.report1Label?.trim() || 'Deep Report';
		const report2Label = ws?.report2Label?.trim() || 'External Report';

		const filesRow = topbar.createDiv({ cls: 'zotero-assistant-files-row' });
		const pills = filesRow.createDiv({ cls: 'zotero-assistant-pills' });

		this.renderReportPill(
			pills,
			file,
			state.citekey,
			'takeaway',
			takeawayLabel,
			'sparkles',
			state.takeawayFile,
			'synthesize',
			true,
			null,
			rerender
		);
		this.renderReportPill(
			pills,
			file,
			state.citekey,
			'report1',
			report1Label,
			'file-search',
			state.report1File,
			'report1',
			false,
			state.deepReportUrl,
			rerender
		);
		this.renderReportPill(
			pills,
			file,
			state.citekey,
			'report2',
			report2Label,
			'globe',
			state.report2File,
			'report2',
			false,
			state.externalReportUrl,
			rerender
		);

		if (state.doiUrl) {
			const doiLink = pills.createEl('a', {
				cls: 'zotero-res-pill is-external',
				href: state.doiUrl,
				attr: { target: '_blank', rel: 'noopener noreferrer', title: state.doiUrl },
			});
			const iconSpan = doiLink.createSpan({ cls: 'zotero-res-pill-icon' });
			setIcon(iconSpan, 'external-link');
			doiLink.createSpan({ text: state.doiUrl.includes('doi.org/') ? 'DOI' : 'URL' });
		}

		const openCodeModal = (currentUrl: string) => {
			new CodeUrlModal(this.plugin.app, currentUrl, async (nextUrl) => {
				await this.plugin.paperHub.updateLiteratureCodeUrl(file, nextUrl);
				new Notice(nextUrl ? 'Saved repository URL.' : 'Cleared repository URL.');
				await rerender();
			}).open();
		};

		if (state.codeUrl) {
			const codeGroup = pills.createDiv({ cls: 'zotero-res-pill-group' });
			const codeLink = codeGroup.createEl('a', {
				cls: 'zotero-res-pill is-external is-code',
				href: state.codeUrl,
				attr: { target: '_blank', rel: 'noopener noreferrer', title: state.codeUrl },
			});
			const iconSpan = codeLink.createSpan({ cls: 'zotero-res-pill-icon' });
			setIcon(iconSpan, 'code-2');
			codeLink.createSpan({ text: 'Code' });
			addIconAction(
				codeGroup,
				'pencil',
				'Edit Code URL',
				() => openCodeModal(state.codeUrl || ''),
				'zotero-res-pill-edit'
			);
		} else {
			const addCodeBtn = pills.createEl('button', {
				cls: 'zotero-res-pill is-missing is-code-missing',
				attr: {
					type: 'button',
					title: 'Set code repository URL',
				},
			});
			addCodeBtn.createSpan({ text: '+ Code' });
			addCodeBtn.onclick = () => openCodeModal('');
		}
	}

	private renderReportPill(
		parent: HTMLElement,
		literatureFile: TFile,
		citekey: string,
		kind: 'takeaway' | 'report1' | 'report2',
		label: string,
		iconName: string,
		existingFile: TFile | null,
		promptId: string,
		isAccent: boolean,
		legacyExternalUrl: string | null,
		rerender: () => Promise<void>
	): void {
		const group = parent.createDiv({ cls: 'zotero-res-pill-group' });

		if (existingFile) {
			const pill = group.createEl('button', {
				cls: `zotero-res-pill is-present${isAccent ? ' is-accent' : ''}`,
				attr: { type: 'button', title: `Open ${existingFile.path}` },
			});
			const iconSpan = pill.createSpan({ cls: 'zotero-res-pill-icon' });
			setIcon(iconSpan, iconName);
			pill.createSpan({ text: label });
			pill.onclick = () => {
				void this.plugin.app.workspace.getLeaf(false).openFile(existingFile);
			};
		} else {
			const createBtn = group.createEl('button', {
				cls: 'zotero-res-pill is-missing',
				attr: {
					type: 'button',
					title: `Create & open ${label} markdown file in Obsidian editor`,
				},
			});
			createBtn.createSpan({ text: `+ ${label}` });
			createBtn.onclick = async () => {
				try {
					const created = await this.plugin.paperHub.createOrOpenReportFile(
						citekey,
						kind,
						literatureFile
					);
					await this.plugin.app.workspace.getLeaf(false).openFile(created);
					await rerender();
				} catch (err) {
					console.error(`[AssistantView] Failed to create ${label}`, err);
					new Notice(`Failed to create ${label}: ${(err as Error)?.message ?? String(err)}`);
				}
			};

			const copyBtn = group.createEl('button', {
				cls: 'zotero-res-pill-copy clickable-icon',
				attr: {
					type: 'button',
					title: `Copy ${label} prompt`,
					'aria-label': `Copy ${label} prompt`,
				},
			});
			setIcon(copyBtn, 'copy');
			copyBtn.onclick = async (ev) => {
				ev.stopPropagation();
				const promptText = await this.plugin.paperHub.getPromptContent(promptId);
				if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(promptText);
					new Notice(`Copied ${label} prompt to clipboard.`);
				}
			};
		}

		if (legacyExternalUrl) {
			const extPill = group.createEl('a', {
				cls: 'zotero-res-pill is-external is-compact-url',
				href: legacyExternalUrl,
				attr: {
					target: '_blank',
					rel: 'noopener noreferrer',
					title: `Open ${label} external URL: ${legacyExternalUrl}`,
					'aria-label': `Open ${label} external URL`,
				},
			});
			const iconSpan = extPill.createSpan({ cls: 'zotero-res-pill-icon' });
			setIcon(iconSpan, 'external-link');
		}
	}

	private triggerWebhookFromToolbar(hook: WebhookProfile, file: TFile): void {
		const vars = (hook.inputVariables ?? []).filter((iv) => iv.name?.trim());
		if (vars.length > 0) {
			new AssistantWebhookInputModal(this.plugin.app, hook.name, vars, (values) => {
				void this.plugin.webhookService.triggerWebhook(
					hook,
					file,
					values,
					this.plugin.settings.webhookDebugMode
				);
			}).open();
		} else {
			void this.plugin.webhookService.triggerWebhook(
				hook,
				file,
				undefined,
				this.plugin.settings.webhookDebugMode
			);
		}
	}

	private async renderCoreNoteBlock(
		container: HTMLElement,
		file: TFile,
		state: PaperState,
		rerender: () => Promise<void>
	): Promise<void> {
		const block = container.createDiv({ cls: 'zotero-core-note-block' });
		const header = block.createDiv({ cls: 'zotero-core-note-header' });
		const left = header.createDiv({ cls: 'zotero-core-note-title-wrap' });
		left.createSpan({ cls: 'zotero-core-note-title', text: 'Core Note' });

		const right = header.createDiv({ cls: 'zotero-core-note-actions' });
		if (state.takeawaySummary.tldr) {
			addIconAction(right, 'sparkles', 'Pull TL;DR from Takeaway', async () => {
				if (!state.coreNoteFile) {
					await this.plugin.paperHub.createOrOpenReportFile(
						state.citekey,
						'coreNote',
						file
					);
				}
				const existing = state.coreNote.body.trim();
				const nextBody = existing
					? `${existing}\n\n> **TL;DR**: ${state.takeawaySummary.tldr}`
					: state.takeawaySummary.tldr;
				await this.plugin.paperHub.saveCoreNote(
					state.citekey,
					{ body: nextBody },
					file
				);
				new Notice('Pulled TL;DR into Core Note.');
				await rerender();
			});
		}

		addIconAction(right, 'arrow-up-right', 'Open Core Note', async () => {
			try {
				const coreFile = await this.plugin.paperHub.createOrOpenReportFile(
					state.citekey,
					'coreNote',
					file
				);
				await this.plugin.app.workspace.getLeaf(false).openFile(coreFile);
			} catch (err) {
				console.error('[AssistantView] Failed to open Core Note in editor', err);
				new Notice(
					`Failed to open Core Note: ${(err as Error)?.message ?? String(err)}`
				);
			}
		});

		const bodyWrap = block.createDiv({ cls: 'zotero-core-note-body' });
		const displayEl = bodyWrap.createDiv({ cls: 'zotero-core-note-display' });
		const currentBody = state.coreNote.body.trim();

		if (currentBody) {
			await renderMarkdownContent(
				this.plugin.app,
				currentBody,
				displayEl,
				file.path,
				this
			);
		} else {
			displayEl.createSpan({
				cls: 'zotero-core-note-placeholder',
				text: 'Click to write core claim & personal takeaways...',
			});
		}

		let editing = false;
		const enterEditMode = () => {
			if (editing) return;
			editing = true;
			bodyWrap.empty();

			const textarea = bodyWrap.createEl('textarea', {
				cls: 'zotero-core-note-editor',
				attr: {
					placeholder:
						'Write core claim, personal takeaways, and connections (Ctrl/Cmd+Enter to save, Esc to cancel)...',
				},
			});
			textarea.value = state.coreNote.body;

			const autoSize = () => {
				textarea.style.height = 'auto';
				textarea.style.height = `${Math.max(84, textarea.scrollHeight)}px`;
			};
			textarea.oninput = autoSize;
			autoSize();

			let finished = false;
			const commit = async () => {
				if (finished) return;
				finished = true;
				const nextVal = textarea.value.trim();
				if (nextVal !== state.coreNote.body.trim()) {
					if (!state.coreNoteFile) {
						await this.plugin.paperHub.createOrOpenReportFile(
							state.citekey,
							'coreNote',
							file
						);
					}
					await this.plugin.paperHub.saveCoreNote(
						state.citekey,
						{ body: nextVal },
						file
					);
				}
				await rerender();
			};

			const cancel = async () => {
				if (finished) return;
				finished = true;
				await rerender();
			};

			textarea.onblur = () => {
				void commit();
			};
			textarea.onkeydown = (ev) => {
				if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
					ev.preventDefault();
					void commit();
				} else if (ev.key === 'Escape') {
					ev.preventDefault();
					void cancel();
				}
			};
			textarea.focus();
		};

		displayEl.onclick = (ev) => {
			if ((ev.target as HTMLElement | null)?.closest('a')) return;
			enterEditMode();
		};
	}

	private renderProjectsAndLinksBar(
		container: HTMLElement,
		file: TFile,
		state: PaperState,
		rerender: () => Promise<void>
	): void {
		const bar = container.createDiv({ cls: 'zotero-links-bar' });

		// Projects Group
		const projGroup = bar.createDiv({ cls: 'zotero-links-group' });
		projGroup.createSpan({ cls: 'zotero-links-label', text: 'Projects' });
		const projChips = projGroup.createDiv({ cls: 'zotero-links-chips' });

		for (const proj of state.projects) {
			const { linkPath, label } = parseWikiDisplay(proj);
			const chip = projChips.createSpan({ cls: 'zotero-link-chip is-project' });
			const anchor = chip.createEl('a', { text: label, href: '#' });
			anchor.onclick = (ev) => {
				ev.preventDefault();
				void this.plugin.app.workspace.openLinkText(linkPath, file.path);
			};
			const removeEl = chip.createSpan({
				cls: 'zotero-link-chip-remove',
				text: '×',
				attr: { title: 'Remove project' },
			});
			removeEl.onclick = async (ev) => {
				ev.stopPropagation();
				const next = state.projects.filter((p) => p !== proj);
				await this.plugin.paperHub.saveCoreNote(
					state.citekey,
					{ projects: next },
					file
				);
				await rerender();
			};
		}

		addIconAction(projChips, 'plus', 'Link a project', () => {
			new AssistantProjectSuggestModal(
				this.plugin.app,
				this.plugin.settings.projectsFolder || 'Projects',
				async (projectFile) => {
					const projCache =
						this.plugin.app.metadataCache.getFileCache(projectFile);
					const idKey = this.plugin.settings.projectIdKey;
					const pathWithoutExt = projectFile.path.replace(/\.[^/.]+$/, '');
					const propVal = projCache?.frontmatter?.[idKey];
					const wiki = propVal
						? `[[${pathWithoutExt}|${propVal}]]`
						: `[[${pathWithoutExt}]]`;
					if (!state.projects.includes(wiki)) {
						const next = [...state.projects, wiki];
						await this.plugin.paperHub.saveCoreNote(
							state.citekey,
							{ projects: next },
							file
						);
						await rerender();
					}
				}
			).open();
		});

		// Linked Notes Group
		const linkedGroup = bar.createDiv({ cls: 'zotero-links-group' });
		linkedGroup.createSpan({ cls: 'zotero-links-label', text: 'Linked' });
		const linkedChips = linkedGroup.createDiv({ cls: 'zotero-links-chips' });

		for (const item of state.coreNote.linkedNotes) {
			const { linkPath, label } = parseWikiDisplay(item);
			const chip = linkedChips.createSpan({ cls: 'zotero-link-chip' });
			const anchor = chip.createEl('a', { text: label, href: '#' });
			anchor.onclick = (ev) => {
				ev.preventDefault();
				void this.plugin.app.workspace.openLinkText(linkPath, file.path);
			};
			const removeEl = chip.createSpan({
				cls: 'zotero-link-chip-remove',
				text: '×',
				attr: { title: 'Unlink note' },
			});
			removeEl.onclick = async (ev) => {
				ev.stopPropagation();
				const next = state.coreNote.linkedNotes.filter((n) => n !== item);
				await this.plugin.paperHub.saveCoreNote(
					state.citekey,
					{ linkedNotes: next },
					file
				);
				await rerender();
			};
		}

		addIconAction(linkedChips, 'plus', 'Link an Atomic or Literature note', () => {
			new VaultMarkdownSuggestModal(
				this.plugin.app,
				async (chosen) => {
					const wiki = `[[${getFileBasename(chosen)}]]`;
					if (!state.coreNote.linkedNotes.includes(wiki)) {
						const next = [...state.coreNote.linkedNotes, wiki];
						await this.plugin.paperHub.saveCoreNote(
							state.citekey,
							{ linkedNotes: next },
							file
						);
						await rerender();
					}
				},
				(f) => f.path !== file.path,
				'Link an Atomic or Literature note...'
			).open();
		});
	}

	private async renderInlineCommentsSection(
		container: HTMLElement,
		fleetingNotes: FleetingNoteSummary[],
		rerender: () => Promise<void>
	): Promise<void> {
		const section = container.createDiv({ cls: 'zotero-inline-comments' });
		section.createDiv({
			cls: 'zotero-inline-comments-header',
			text: `Highlights & Thoughts (${fleetingNotes.length})`,
		});

		const list = section.createDiv({ cls: 'zotero-inline-comments-list' });
		const renderTasks: Promise<void>[] = [];

		for (const item of fleetingNotes) {
			const row = list.createDiv({ cls: 'zotero-inline-comment-row' });
			const textCol = row.createDiv({ cls: 'zotero-inline-comment-main' });
			const noteLink = textCol.createEl('a', {
				cls: 'zotero-inline-comment-link',
				text: getFileBasename(item.file),
				href: '#',
			});
			noteLink.onclick = (ev) => {
				ev.preventDefault();
				void this.plugin.app.workspace.getLeaf(false).openFile(item.file);
			};
			if (item.thought) {
				const snippetEl = textCol.createDiv({ cls: 'zotero-inline-comment-snippet' });
				renderTasks.push(
					renderMarkdownContent(
						this.plugin.app,
						item.thought,
						snippetEl,
						item.file.path,
						this
					)
				);
			}

			const toggleBadge = row.createEl('button', {
				cls: `zotero-read-badge ${item.read ? 'is-read' : 'is-unread'}`,
				text: item.read ? 'Read' : 'Unread',
				attr: { type: 'button', title: 'Toggle read state' },
			});
			toggleBadge.onclick = async () => {
				if (this.plugin.app.fileManager?.processFrontMatter) {
					await this.plugin.app.fileManager.processFrontMatter(item.file, (fm) => {
						fm['read'] = !item.read;
					});
				}
				await rerender();
			};
		}

		await Promise.all(renderTasks);
	}

	private async renderLegacyScript(
		file: TFile,
		container: HTMLElement,
		source: string
	): Promise<void> {
		const customScript = this.plugin.settings.assistantScript;
		if (!customScript || !customScript.trim()) return;
		if (!this.plugin.dataviewService.isAvailable) {
			container.createDiv({
				text: 'Dataview plugin not found.',
				cls: 'zotero-text-muted-italic',
			});
			return;
		}
		const lines = source.trim().split('\n');
		const params: Record<string, unknown> = {};
		lines.slice(1).forEach((line) => {
			const [key, value] = line.split(/[=:]/).map((s) => s.trim());
			if (key && value) {
				try {
					params[key] = JSON.parse(value);
				} catch {
					params[key] = value.replace(/^["']|["']$/g, '');
				}
			}
		});
		await this.plugin.dataviewService.executeScript(
			customScript,
			container,
			this,
			file.path,
			params
		);
	}

	private renderVenueAndCfpBar(container: HTMLElement, file: TFile): void {
		const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		if (!fm) return;

		const acronymKey = this.plugin.settings.cfpAcronymKey?.trim() || 'conference-acronym';
		const rawAcronym = String(
			fm[acronymKey] ?? fm['acronym'] ?? fm['conference_acronym'] ?? ''
		).trim();
		const rawVenue = String(fm['venue'] ?? fm['publication'] ?? '').trim();

		let seriesName = '';
		let seriesNotePath = '';

		if (this.plugin.cfpService) {
			const candidateRaw = rawAcronym || rawVenue;
			const wikiMatch = candidateRaw.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
			if (wikiMatch) {
				const linkTarget = wikiMatch[1].trim();
				const resolved =
					this.plugin.app.metadataCache.getFirstLinkpathDest?.(
						linkTarget,
						file.path
					) ??
					this.plugin.app.vault.getAbstractFileByPath(
						normalizePath(
							linkTarget.endsWith('.md') ? linkTarget : `${linkTarget}.md`
						)
					);
				if (resolved instanceof TFile) {
					const info = this.plugin.cfpService.getCFPNoteInfoByPath(resolved.path);
					if (info) {
						if (info.isSeries) {
							seriesName = info.seriesName;
							seriesNotePath = info.seriesNotePath;
						} else {
							seriesName = info.event.item.series || info.event.item.acronym;
							const byAcronym =
								this.plugin.cfpService.getSeriesInfoByAcronym(seriesName);
							if (byAcronym) seriesNotePath = byAcronym.seriesNotePath;
						}
					}
				}
			}

			if (!seriesNotePath) {
				const normalizedLookup = normalizeVenueSeries(rawAcronym || rawVenue);
				if (normalizedLookup) {
					const sInfo =
						this.plugin.cfpService.getSeriesInfoByAcronym(normalizedLookup);
					if (sInfo) {
						seriesName = sInfo.seriesName;
						seriesNotePath = sInfo.seriesNotePath;
					}
				}
			}
		}

		const displaySeries = seriesName || normalizeVenueSeries(rawAcronym || rawVenue);
		const sameVenuePapers = this.plugin.vaultLibrary.findSameVenuePapers(
			file,
			displaySeries
		);

		if (!displaySeries && sameVenuePapers.length === 0) return;

		let rankCore = '';
		let rankCcf = '';
		if (seriesNotePath) {
			const sFile = this.plugin.app.vault.getAbstractFileByPath(seriesNotePath);
			if (sFile instanceof TFile) {
				const sFm = this.plugin.app.metadataCache.getFileCache(sFile)?.frontmatter;
				rankCore = String(sFm?.['rank_core'] ?? '').trim();
				rankCcf = String(sFm?.['rank_ccf'] ?? '').trim();
			}
		}

		const footer = container.createDiv({ cls: 'zotero-venue-bar' });
		const metaLeft = footer.createDiv({ cls: 'zotero-venue-meta' });

		if (displaySeries) {
			metaLeft.createSpan({ cls: 'zotero-venue-acronym', text: displaySeries });
		}
		if (rankCore) {
			metaLeft.createSpan({ cls: 'zotero-venue-rank is-core', text: `CORE ${rankCore}` });
		}
		if (rankCcf) {
			metaLeft.createSpan({ cls: 'zotero-venue-rank is-ccf', text: `CCF ${rankCcf}` });
		}
		if (seriesNotePath) {
			const seriesLink = metaLeft.createEl('a', {
				cls: 'zotero-venue-series-link',
				text: `${seriesName || displaySeries} Series`,
				href: '#',
			});
			seriesLink.onclick = (ev) => {
				ev.preventDefault();
				const target = this.plugin.app.vault.getAbstractFileByPath(seriesNotePath);
				if (target instanceof TFile) {
					void this.plugin.app.workspace.getLeaf(false).openFile(target);
				}
			};
		}

		if (sameVenuePapers.length > 0) {
			const peersWrap = footer.createDiv({ cls: 'zotero-venue-peers' });
			for (const peer of sameVenuePapers.slice(0, MAX_INLINE_VENUE_PAPERS)) {
				const chip = peersWrap.createEl('a', {
					cls: 'zotero-venue-peer-chip',
					text: peer.shortLabel,
					href: '#',
					attr: { title: peer.title },
				});
				chip.onclick = (ev) => {
					ev.preventDefault();
					void this.plugin.app.workspace.getLeaf(false).openFile(peer.file);
				};
			}

			const jumpText =
				sameVenuePapers.length > MAX_INLINE_VENUE_PAPERS
					? `+${sameVenuePapers.length - MAX_INLINE_VENUE_PAPERS} in Library →`
					: `Library (${sameVenuePapers.length}) →`;
			const jumpBtn = peersWrap.createEl('button', {
				cls: 'zotero-venue-library-btn',
				text: jumpText,
				attr: { type: 'button' },
			});
			jumpBtn.onclick = () => {
				void import('./digest-view').then((mod) =>
					mod.openPaperLibrary(this.plugin, displaySeries)
				);
			};
		}
	}
}
