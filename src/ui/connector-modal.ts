import {
	App,
	Component,
	FuzzySuggestModal,
	MarkdownRenderer,
	Modal,
	Notice,
	setIcon,
	TFile,
} from 'obsidian';
import type ZoteroGKPlugin from '../main';
import { PaperState } from '../services/paper-hub';
import {
	CandidateVaultMatch,
	CitedVaultPaperMatch,
	ConnectorMatchResult,
} from '../services/vault-library';
import { normalizePath } from '../utils/paths';

function getBasename(file: TFile): string {
	if (file.basename) return file.basename;
	return (file.name || file.path.split('/').pop() || '').replace(/\.md$/i, '');
}

export async function renderMarkdownContent(
	app: App,
	markdown: string,
	container: HTMLElement,
	sourcePath: string,
	component: Component
): Promise<void> {
	const extContainer = container as HTMLElement & {
		addClass?: (...cls: string[]) => void;
		setText?: (text: string) => void;
	};
	if (typeof extContainer.addClass === 'function') {
		extContainer.addClass('markdown-rendered');
	} else {
		container.classList.add('markdown-rendered');
	}
	if (typeof extContainer.setText !== 'function') {
		extContainer.setText = (text: string) => {
			container.textContent = text;
		};
	}

	await MarkdownRenderer.render(app, markdown, container, sourcePath, component);

	container.addEventListener('click', (ev: MouseEvent) => {
		const target = ev.target as HTMLElement | null;
		const linkEl = target?.closest?.('a.internal-link') as HTMLElement | null;
		if (!linkEl) return;
		ev.preventDefault();
		ev.stopPropagation();
		const linkTarget =
			linkEl.getAttribute('data-href') || linkEl.getAttribute('href') || '';
		if (linkTarget && app.workspace?.openLinkText) {
			void app.workspace.openLinkText(linkTarget, sourcePath);
		}
	});
}

export class VaultMarkdownSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onChoose: (file: TFile) => void | Promise<void>,
		private readonly filterFn?: (file: TFile) => boolean,
		placeholder = 'Choose a note in Vault...'
	) {
		super(app);
		this.setPlaceholder?.(placeholder);
	}

	getItems(): TFile[] {
		const files = this.app.vault.getMarkdownFiles();
		return this.filterFn ? files.filter(this.filterFn) : files;
	}

	getItemText(file: TFile): string {
		return `${getBasename(file)} — ${file.path}`;
	}

	onChooseItem(file: TFile): void {
		void this.onChoose(file);
	}
}

export class ConnectorModal extends Modal {
	private state: PaperState | null = null;
	private matchResult: ConnectorMatchResult = { candidateMatches: [], citedPapers: [] };
	private selectedIndex = 0;
	private appendEvidence = true;
	private mdComponent = new Component();

	constructor(
		app: App,
		private readonly plugin: ZoteroGKPlugin,
		private readonly literatureFile: TFile,
		private readonly onUpdated?: () => void | Promise<void>
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		this.mdComponent.load();
		(this as { modalEl?: HTMLElement }).modalEl?.addClass('zotero-connector-modal-shell');
		this.contentEl.addClass('zotero-connector-modal');
		await this.refreshState();
	}

	onClose(): void {
		this.mdComponent.unload();
		this.contentEl.empty();
	}

	private async refreshState(): Promise<void> {
		this.state = await this.plugin.paperHub.getPaperState(this.literatureFile);
		if (!this.state) {
			this.renderNoCitekey();
			return;
		}

		const report1Raw = this.state.report1File
			? await this.app.vault.read(this.state.report1File)
			: '';
		const reportTexts = [this.state.takeawayRaw, this.state.report2Raw, report1Raw].filter(
			Boolean
		);

		this.matchResult = this.plugin.vaultLibrary.matchCandidatesAgainstVault(
			this.state.takeawayCandidates,
			reportTexts,
			this.state.citekey
		);

		if (this.selectedIndex >= this.matchResult.candidateMatches.length) {
			this.selectedIndex = 0;
		}
		await this.renderContent();
	}

	private renderNoCitekey(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Vault Knowledge Connector' });
		contentEl.createDiv({
			cls: 'zotero-connector-empty',
			text: 'No citation key found in this note frontmatter.',
		});
	}

	private isNoteLinked(basenameOrLink: string): boolean {
		if (!this.state) return false;
		const clean = basenameOrLink
			.replace(/^\[\[|\]\]$/g, '')
			.split('|')[0]
			.split('/')
			.pop()
			?.replace(/\.md$/i, '')
			.trim()
			.toLowerCase();
		if (!clean) return false;
		return this.state.coreNote.linkedNotes.some((item) => {
			const inner = item.replace(/^\[\[|\]\]$/g, '').trim();
			const [rawTarget, rawAlias] = inner.split('|');
			const targetBase = rawTarget
				?.split('/')
				.pop()
				?.replace(/\.md$/i, '')
				.trim()
				.toLowerCase();
			const aliasBase = rawAlias?.replace(/\.md$/i, '').trim().toLowerCase();
			return targetBase === clean || aliasBase === clean;
		});
	}

	private async renderContent(): Promise<void> {
		this.mdComponent.unload();
		this.mdComponent = new Component();
		this.mdComponent.load();

		const { contentEl } = this;
		contentEl.empty();
		const state = this.state;
		if (!state) return;

		const header = contentEl.createDiv({ cls: 'zotero-connector-header' });
		const titleWrap = header.createDiv({ cls: 'zotero-connector-title-wrap' });
		const iconEl = titleWrap.createSpan({ cls: 'zotero-connector-title-icon' });
		setIcon(iconEl, 'link-2');
		titleWrap.createEl('h3', {
			text: `Connect Paper to Vault · ${state.citekey}`,
			cls: 'zotero-connector-title',
		});

		const { candidateMatches, citedPapers } = this.matchResult;
		if (candidateMatches.length === 0 && citedPapers.length === 0) {
			this.renderEmptyState(contentEl, state);
			return;
		}

		const columns = contentEl.createDiv({ cls: 'zotero-connector-columns' });
		const leftPane = columns.createDiv({ cls: 'zotero-connector-left' });
		const rightPane = columns.createDiv({ cls: 'zotero-connector-right' });

		this.renderLeftPane(leftPane, state, candidateMatches, citedPapers);
		await this.renderRightPane(rightPane, state, candidateMatches[this.selectedIndex] ?? null);
	}

	private renderEmptyState(container: HTMLElement, state: PaperState): void {
		const box = container.createDiv({ cls: 'zotero-connector-empty' });
		box.createEl('h4', { text: 'No Takeaway Candidates Yet' });
		box.createEl('p', {
			text:
				'Create and open the Takeaway.md file in Obsidian to paste synthesized Markdown directly, or trigger a synthesis webhook.',
			cls: 'zotero-text-muted',
		});

		const actions = box.createDiv({ cls: 'zotero-connector-empty-actions' });

		const createOpenBtn = actions.createEl('button', {
			cls: 'mod-cta zotero-connector-btn',
			text: '+ Create & Open Takeaway.md',
			attr: { type: 'button' },
		});
		createOpenBtn.onclick = async () => {
			try {
				const created = await this.plugin.paperHub.createOrOpenReportFile(
					state.citekey,
					'takeaway',
					this.literatureFile
				);
				await this.app.workspace.getLeaf(false).openFile(created);
				await this.notifyUpdated();
				this.close();
			} catch (err) {
				console.error('[ConnectorModal] Failed to create/open Takeaway.md', err);
				new Notice(`Failed to open Takeaway.md: ${(err as Error)?.message ?? String(err)}`);
			}
		};

		const copyPromptBtn = actions.createEl('button', {
			cls: 'zotero-connector-btn',
			text: 'Copy Synthesize Prompt',
			attr: { type: 'button' },
		});
		copyPromptBtn.onclick = async () => {
			try {
				const prompt = await this.plugin.paperHub.getPromptContent('synthesize');
				if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(prompt);
					new Notice('Copied synthesize prompt to clipboard.');
				}
			} catch (err) {
				console.error('[ConnectorModal] Failed to copy prompt', err);
				new Notice(`Failed to copy prompt: ${(err as Error)?.message ?? String(err)}`);
			}
		};

		const visibleHooks = (this.plugin.settings.webhooks || []).filter((h) => !h.hidden);
		for (const hook of visibleHooks) {
			const hookBtn = actions.createEl('button', {
				cls: 'zotero-connector-btn',
				text: `Trigger: ${hook.name}`,
				attr: { type: 'button' },
			});
			hookBtn.onclick = async () => {
				try {
					await this.plugin.webhookService.triggerWebhook(
						hook,
						this.literatureFile,
						undefined,
						this.plugin.settings.webhookDebugMode
					);
				} catch (err) {
					console.error('[ConnectorModal] Webhook trigger failed', err);
					new Notice(`Webhook failed: ${(err as Error)?.message ?? String(err)}`);
				}
			};
		}
	}

	private renderLeftPane(
		leftPane: HTMLElement,
		state: PaperState,
		candidateMatches: CandidateVaultMatch[],
		citedPapers: CitedVaultPaperMatch[]
	): void {
		leftPane.createDiv({
			cls: 'zotero-connector-section-label',
			text: `Candidate Atomic Zettels (${candidateMatches.length})`,
		});

		if (candidateMatches.length === 0) {
			leftPane.createDiv({
				cls: 'zotero-connector-subtle',
				text: 'No ### Candidate blocks found in Takeaway.',
			});
		} else {
			const candList = leftPane.createDiv({ cls: 'zotero-connector-list' });
			candidateMatches.forEach((match, idx) => {
				const item = candList.createDiv({
					cls: `zotero-connector-item ${idx === this.selectedIndex ? 'is-selected' : ''}`,
				});
				item.onclick = () => {
					this.selectedIndex = idx;
					void this.renderContent();
				};

				const topRow = item.createDiv({ cls: 'zotero-connector-item-top' });
				const leftMeta = topRow.createDiv({ cls: 'zotero-connector-item-meta' });
				leftMeta.createSpan({
					cls: 'zotero-connector-item-index',
					text: `#${match.candidate.index}`,
				});
				if (match.candidate.typeLabel) {
					leftMeta.createSpan({
						cls: 'zotero-connector-type-chip',
						text: match.candidate.typeLabel,
					});
				}

				const linked =
					(match.matchedFile && this.isNoteLinked(getBasename(match.matchedFile))) ||
					this.isNoteLinked(match.candidate.linkTitle);

				const badgeText = linked
					? 'Linked'
					: match.matchedFile
						? 'Matched'
						: 'Proposed';
				const badgeCls = linked
					? 'is-linked'
					: match.matchedFile
						? 'is-matched'
						: 'is-proposed';
				topRow.createSpan({
					cls: `zotero-connector-badge ${badgeCls}`,
					text: badgeText,
				});

				item.createDiv({
					cls: 'zotero-connector-item-title',
					text: match.candidate.linkTitle,
				});
				const subText = match.candidate.brief || match.candidate.storyline;
				if (subText) {
					item.createDiv({
						cls: 'zotero-connector-item-sub',
						text: subText,
					});
				}
			});
		}

		leftPane.createDiv({
			cls: 'zotero-connector-section-label zotero-connector-section-spaced',
			text: `Cited Vault Papers (${citedPapers.length})`,
		});

		if (citedPapers.length === 0) {
			leftPane.createDiv({
				cls: 'zotero-connector-subtle',
				text: 'No cited papers matched existing Literature notes.',
			});
		} else {
			const citedList = leftPane.createDiv({ cls: 'zotero-connector-cited-list' });
			for (const cited of citedPapers) {
				const row = citedList.createDiv({ cls: 'zotero-connector-cited-row' });
				const info = row.createDiv({ cls: 'zotero-connector-cited-info' });
				const titleLink = info.createEl('a', {
					cls: 'zotero-connector-cited-title',
					text: cited.title,
					href: '#',
				});
				titleLink.onclick = (ev) => {
					ev.preventDefault();
					void this.app.workspace.getLeaf(false).openFile(cited.file);
					this.close();
				};
				const metaParts = [cited.citekey, cited.year, `via ${cited.matchedBy}`].filter(
					Boolean
				);
				info.createDiv({
					cls: 'zotero-connector-item-sub',
					text: metaParts.join(' · '),
				});

				const base = getBasename(cited.file);
				const alreadyLinked = this.isNoteLinked(base);
				const btn = row.createEl('button', {
					cls: `zotero-connector-mini-btn ${alreadyLinked ? 'is-linked' : ''}`,
					text: alreadyLinked ? 'Linked' : 'Link',
					attr: { type: 'button' },
				});
				btn.disabled = alreadyLinked;
				btn.onclick = async () => {
					try {
						const wiki = `[[${base}]]`;
						const next = state.coreNote.linkedNotes.includes(wiki)
							? state.coreNote.linkedNotes
							: [...state.coreNote.linkedNotes, wiki];
						await this.plugin.paperHub.saveCoreNote(
							state.citekey,
							{ linkedNotes: next },
							this.literatureFile
						);
						new Notice(`Linked ${wiki} to Core Note.`);
						await this.notifyUpdated();
						await this.refreshState();
					} catch (err) {
						console.error('[ConnectorModal] Failed to link cited paper', err);
						new Notice(`Failed to link paper: ${(err as Error)?.message ?? String(err)}`);
					}
				};
			}
		}
	}

	private async renderRightPane(
		rightPane: HTMLElement,
		state: PaperState,
		selected: CandidateVaultMatch | null
	): Promise<void> {
		if (!selected) {
			rightPane.createDiv({
				cls: 'zotero-connector-subtle',
				text: 'Select a Candidate Atomic Zettel on the left to review and link it.',
			});
			return;
		}

		const { candidate, matchedFile, matchType } = selected;
		const head = rightPane.createDiv({ cls: 'zotero-connector-detail-head' });
		head.createEl('h4', {
			cls: 'zotero-connector-detail-title',
			text: candidate.linkTitle,
		});

		const metaChips: Array<{ label: string; value: string }> = [
			{ label: 'Type', value: candidate.typeLabel || '' },
			{ label: 'Source', value: candidate.source || '' },
			{ label: 'Storyline', value: candidate.storyline },
			{ label: 'Answers', value: candidate.answers || '' },
			{ label: 'Link Status', value: candidate.linkStatus },
		].filter((m) => Boolean(m.value));

		if (metaChips.length > 0) {
			const chipsRow = head.createDiv({ cls: 'zotero-connector-meta-chips' });
			for (const item of metaChips) {
				chipsRow.createSpan({
					cls: 'zotero-connector-meta-chip',
					text: `${item.label}: ${item.value}`,
				});
			}
		}

		const fields = rightPane.createDiv({ cls: 'zotero-connector-fields' });
		const renderTasks: Promise<void>[] = [];

		const addMarkdownField = (label: string, value: string | undefined) => {
			if (!value) return;
			const row = fields.createDiv({ cls: 'zotero-connector-field-row' });
			row.createSpan({ cls: 'zotero-connector-field-key', text: label });
			const valEl = row.createDiv({
				cls: 'zotero-connector-field-val zotero-connector-md-val',
			});
			renderTasks.push(
				renderMarkdownContent(
					this.app,
					value,
					valEl,
					this.literatureFile.path,
					this.mdComponent
				)
			);
		};

		addMarkdownField('Brief', candidate.brief);
		addMarkdownField('Evidence', candidate.evidence);
		addMarkdownField('Validation', candidate.validation);
		addMarkdownField('Related Papers', candidate.relatedPapers);

		if (candidate.tags.length > 0) {
			const row = fields.createDiv({ cls: 'zotero-connector-field-row' });
			row.createSpan({ cls: 'zotero-connector-field-key', text: 'Tags' });
			row.createSpan({
				cls: 'zotero-connector-field-val zotero-connector-tags-val',
				text: candidate.tags.map((t) => `#${t}`).join('  '),
			});
		}

		if (matchedFile) {
			const previewWrap = rightPane.createDiv({ cls: 'zotero-connector-preview-card' });
			const previewHead = previewWrap.createDiv({ cls: 'zotero-connector-preview-head' });
			const isLinked =
				this.isNoteLinked(getBasename(matchedFile)) ||
				this.isNoteLinked(candidate.linkTitle);
			previewHead.createSpan({
				text: `${isLinked ? 'Linked' : 'Matched'} (${
					matchType === 'exact' ? 'Exact Title' : 'Concept Overlap'
				}): ${matchedFile.path}`,
			});
			const openExisting = previewHead.createEl('a', {
				text: 'Open in Obsidian',
				href: '#',
				cls: 'zotero-connector-open-link',
			});
			openExisting.onclick = (ev) => {
				ev.preventDefault();
				void this.app.workspace.getLeaf(false).openFile(matchedFile);
				this.close();
			};

			const previewBody = previewWrap.createDiv({
				cls: 'zotero-connector-preview-rendered',
			});
			renderTasks.push(
				this.app.vault.read(matchedFile).then((existingContent) =>
					renderMarkdownContent(
						this.app,
						existingContent,
						previewBody,
						matchedFile.path,
						this.mdComponent
					)
				)
			);
		}

		await Promise.all(renderTasks);

		const sanitizedName = (candidate.linkTitle || `A - Concept - ${state.citekey}`)
			.replace(/\.md$/i, '')
			.replace(/[\\/:*?"<>|]/g, '-')
			.trim();
		const atomicFolder = normalizePath(
			this.plugin.settings.paperWorkspace.atomicNotesFolder || '003-Permanent'
		);
		const targetDisplayPath = atomicFolder
			? `${atomicFolder}/${sanitizedName}.md`
			: `${sanitizedName}.md`;

		if (!matchedFile) {
			rightPane.createDiv({
				cls: 'zotero-connector-target-hint',
				text: `Target: ${targetDisplayPath}`,
			});
		}

		const appendRow = rightPane.createEl('label', { cls: 'zotero-connector-checkbox-row' });
		const checkbox = appendRow.createEl('input', {
			attr: { type: 'checkbox' },
		}) as HTMLInputElement;
		checkbox.checked = this.appendEvidence;
		checkbox.onchange = () => {
			this.appendEvidence = checkbox.checked;
		};
		appendRow.createSpan({
			text: `Append "Evidence from [[${state.citekey}]]" section to target note`,
		});

		const actions = rightPane.createDiv({ cls: 'zotero-connector-actions' });

		if (matchedFile) {
			const matchedBase = getBasename(matchedFile);
			const linkMatchedBtn = actions.createEl('button', {
				cls: 'mod-cta zotero-connector-btn',
				text: 'Link a note',
				attr: {
					type: 'button',
					title: `Link and append evidence to ${matchedBase}`,
					'aria-label': `Link and append evidence to ${matchedBase}`,
				},
			});
			linkMatchedBtn.onclick = async () => {
				try {
					const target = await this.plugin.vaultLibrary.connectCandidateToVault({
						literatureFile: this.literatureFile,
						citekey: state.citekey,
						candidate,
						mode: 'reuse',
						targetFile: matchedFile,
						appendEvidence: this.appendEvidence,
					});
					new Notice(`Linked note: ${getBasename(target)}`);
					await this.notifyUpdated();
					await this.refreshState();
				} catch (err) {
					console.error('[ConnectorModal] Failed to link existing note', err);
					new Notice(
						`Failed to link note: ${(err as Error)?.message ?? String(err)}`
					);
				}
			};

			const rebindBtn = actions.createEl('button', {
				cls: 'zotero-connector-btn',
				text: 'Choose another note...',
				attr: { type: 'button' },
			});
			rebindBtn.onclick = () => {
				new VaultMarkdownSuggestModal(
					this.app,
					async (chosenFile) => {
						try {
							const target = await this.plugin.vaultLibrary.connectCandidateToVault({
								literatureFile: this.literatureFile,
								citekey: state.citekey,
								candidate,
								mode: 'reuse',
								targetFile: chosenFile,
								appendEvidence: this.appendEvidence,
								rewriteTakeaway: true,
							});
							new Notice(`Linked to note: ${getBasename(target)}`);
							await this.notifyUpdated();
							await this.refreshState();
						} catch (err) {
							console.error('[ConnectorModal] Failed to rebind vault note', err);
							new Notice(
								`Failed to link note: ${(err as Error)?.message ?? String(err)}`
							);
						}
					},
					(f) => f.path !== this.literatureFile.path,
					'Choose an existing Atomic or Vault note...'
				).open();
			};

			const createAnywayBtn = actions.createEl('button', {
				cls: 'zotero-connector-btn',
				text: 'Create a note',
				attr: {
					type: 'button',
					title: `Create new note at ${targetDisplayPath}`,
				},
			});
			createAnywayBtn.onclick = async () => {
				try {
					const target = await this.plugin.vaultLibrary.connectCandidateToVault({
						literatureFile: this.literatureFile,
						citekey: state.citekey,
						candidate,
						mode: 'create',
						appendEvidence: this.appendEvidence,
					});
					new Notice(`Created and linked note: ${getBasename(target)}`);
					await this.notifyUpdated();
					await this.refreshState();
				} catch (err) {
					console.error('[ConnectorModal] Failed to create atomic note', err);
					new Notice(
						`Failed to create note: ${(err as Error)?.message ?? String(err)}`
					);
				}
			};
		} else {
			const createBtn = actions.createEl('button', {
				cls: 'mod-cta zotero-connector-btn',
				text: 'Create a note',
				attr: {
					type: 'button',
					title: `Create ${targetDisplayPath}`,
				},
			});
			createBtn.onclick = async () => {
				try {
					const target = await this.plugin.vaultLibrary.connectCandidateToVault({
						literatureFile: this.literatureFile,
						citekey: state.citekey,
						candidate,
						mode: 'create',
						appendEvidence: this.appendEvidence,
					});
					new Notice(`Created and linked note: ${getBasename(target)}`);
					await this.notifyUpdated();
					await this.refreshState();
				} catch (err) {
					console.error('[ConnectorModal] Failed to create atomic note', err);
					new Notice(
						`Failed to create note: ${(err as Error)?.message ?? String(err)}`
					);
				}
			};

			const chooseExistingBtn = actions.createEl('button', {
				cls: 'zotero-connector-btn',
				text: 'Link a note',
				attr: {
					type: 'button',
					title: 'Choose an existing Vault note instead of creating a new one',
				},
			});
			chooseExistingBtn.onclick = () => {
				new VaultMarkdownSuggestModal(
					this.app,
					async (chosenFile) => {
						try {
							const target = await this.plugin.vaultLibrary.connectCandidateToVault({
								literatureFile: this.literatureFile,
								citekey: state.citekey,
								candidate,
								mode: 'reuse',
								targetFile: chosenFile,
								appendEvidence: this.appendEvidence,
								rewriteTakeaway: true,
							});
							new Notice(`Linked note: ${getBasename(target)}`);
							await this.notifyUpdated();
							await this.refreshState();
						} catch (err) {
							console.error('[ConnectorModal] Failed to link chosen note', err);
							new Notice(
								`Failed to link note: ${(err as Error)?.message ?? String(err)}`
							);
						}
					},
					(f) => f.path !== this.literatureFile.path,
					'Choose an existing Atomic or Vault note...'
				).open();
			};
		}
	}

	private async notifyUpdated(): Promise<void> {
		if (this.onUpdated) {
			await this.onUpdated();
		}
	}
}
