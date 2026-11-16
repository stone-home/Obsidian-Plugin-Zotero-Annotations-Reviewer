import {
	App,
	ButtonComponent,
	FuzzySuggestModal,
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

function getBasename(file: TFile): string {
	if (file.basename) return file.basename;
	return (file.name || file.path.split('/').pop() || '').replace(/\.md$/i, '');
}

export class VaultMarkdownSuggestModal extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onChoose: (file: TFile) => void,
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
		this.onChoose(file);
	}
}

export class ConnectorModal extends Modal {
	private state: PaperState | null = null;
	private matchResult: ConnectorMatchResult = { candidateMatches: [], citedPapers: [] };
	private selectedIndex = 0;
	private appendEvidence = true;

	constructor(
		app: App,
		private readonly plugin: ZoteroGKPlugin,
		private readonly literatureFile: TFile,
		private readonly onUpdated?: () => void | Promise<void>
	) {
		super(app);
	}

	async onOpen(): Promise<void> {
		(this as { modalEl?: HTMLElement }).modalEl?.addClass('zotero-connector-modal-shell');
		this.contentEl.addClass('zotero-connector-modal');
		await this.refreshState();
	}

	onClose(): void {
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
			?.toLowerCase();
		if (!clean) return false;
		return this.state.coreNote.linkedNotes.some((item) => {
			const target = item
				.replace(/^\[\[|\]\]$/g, '')
				.split('|')[0]
				.split('/')
				.pop()
				?.toLowerCase();
			return target === clean;
		});
	}

	private async renderContent(): Promise<void> {
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
				'Paste a synthesized Takeaway (Markdown or JSON envelope) below to extract Candidate Atomic Zettels and discover cited papers already in your vault.',
			cls: 'zotero-text-muted',
		});

		const textarea = box.createEl('textarea', {
			cls: 'zotero-connector-paste-area',
			attr: {
				rows: '8',
				placeholder: 'Paste Takeaway Markdown or JSON ({ "markdown_body": "..." })...',
			},
		});

		const actions = box.createDiv({ cls: 'zotero-connector-empty-actions' });
		new ButtonComponent(actions)
			.setButtonText('Save Takeaway & Scan')
			.setCta()
			.onClick(async () => {
				const raw = textarea.value.trim();
				if (!raw) {
					new Notice('Paste Takeaway content first.');
					return;
				}
				await this.plugin.paperHub.saveReportMarkdown(
					state.citekey,
					'takeaway',
					raw,
					this.literatureFile
				);
				new Notice('Takeaway saved.');
				await this.notifyUpdated();
				await this.refreshState();
			});

		new ButtonComponent(actions)
			.setButtonText('Copy Synthesize Prompt')
			.onClick(async () => {
				const prompt = await this.plugin.paperHub.getPromptContent('synthesize');
				if (navigator.clipboard?.writeText) {
					await navigator.clipboard.writeText(prompt);
					new Notice('Copied synthesize prompt to clipboard.');
				}
			});

		const visibleHooks = (this.plugin.settings.webhooks || []).filter((h) => !h.hidden);
		for (const hook of visibleHooks) {
			new ButtonComponent(actions)
				.setButtonText(`Trigger: ${hook.name}`)
				.onClick(async () => {
					await this.plugin.webhookService.triggerWebhook(
						hook,
						this.literatureFile,
						undefined,
						this.plugin.settings.webhookDebugMode
					);
				});
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
				topRow.createSpan({
					cls: 'zotero-connector-item-index',
					text: `#${match.candidate.index}`,
				});

				item.createDiv({
					cls: 'zotero-connector-item-title',
					text: match.candidate.linkTitle,
				});
				if (match.candidate.storyline) {
					item.createDiv({
						cls: 'zotero-connector-item-sub',
						text: match.candidate.storyline,
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
				});
				btn.disabled = alreadyLinked;
				btn.onclick = async () => {
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

		const fields = rightPane.createDiv({ cls: 'zotero-connector-fields' });
		const addField = (label: string, value: string) => {
			if (!value) return;
			const row = fields.createDiv({ cls: 'zotero-connector-field-row' });
			row.createSpan({ cls: 'zotero-connector-field-key', text: label });
			row.createSpan({ cls: 'zotero-connector-field-val', text: value });
		};

		addField('Storyline', candidate.storyline);
		addField('Brief Claim', candidate.brief);
		addField('Evidence', candidate.evidence);
		addField('Related Papers', candidate.relatedPapers);
		if (candidate.tags.length > 0) {
			addField('Tags', candidate.tags.map((t) => `#${t}`).join('  '));
		}

		if (matchedFile) {
			const previewWrap = rightPane.createDiv({ cls: 'zotero-connector-preview-card' });
			const previewHead = previewWrap.createDiv({ cls: 'zotero-connector-preview-head' });
			previewHead.createSpan({
				text: `Existing Vault Match (${matchType === 'exact' ? 'Exact Title' : 'Concept Overlap'}): ${matchedFile.path}`,
			});
			const openExisting = previewHead.createEl('a', {
				text: 'Open',
				href: '#',
				cls: 'zotero-connector-open-link',
			});
			openExisting.onclick = (ev) => {
				ev.preventDefault();
				void this.app.workspace.getLeaf(false).openFile(matchedFile);
				this.close();
			};

			const existingContent = await this.app.vault.read(matchedFile);
			previewWrap.createEl('pre', {
				cls: 'zotero-connector-preview-body',
				text: existingContent.slice(0, 1200),
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
			text: `Append "Evidence from [[${state.citekey}]]" section to the target Atomic Note`,
		});

		const actions = rightPane.createDiv({ cls: 'zotero-connector-actions' });
		if (matchedFile) {
			new ButtonComponent(actions)
				.setButtonText('Link & Append Evidence')
				.setCta()
				.onClick(async () => {
					const target = await this.plugin.vaultLibrary.connectCandidateToVault({
						literatureFile: this.literatureFile,
						citekey: state.citekey,
						candidate,
						mode: 'reuse',
						targetFile: matchedFile,
						appendEvidence: this.appendEvidence,
					});
					new Notice(`Connected to existing note: ${getBasename(target)}`);
					await this.notifyUpdated();
					await this.refreshState();
				});
		}

		new ButtonComponent(actions)
			.setButtonText('Choose Another Vault Note...')
			.onClick(() => {
				new VaultMarkdownSuggestModal(
					this.app,
					async (chosenFile) => {
						const target = await this.plugin.vaultLibrary.connectCandidateToVault({
							literatureFile: this.literatureFile,
							citekey: state.citekey,
							candidate,
							mode: 'reuse',
							targetFile: chosenFile,
							appendEvidence: this.appendEvidence,
						});
						new Notice(`Connected to ${getBasename(target)}`);
						await this.notifyUpdated();
						await this.refreshState();
					},
					(f) => f.path !== this.literatureFile.path,
					'Choose an existing Atomic or Vault note...'
				).open();
			});

		const createBtn = new ButtonComponent(actions).setButtonText('Create New Atomic Note');
		if (!matchedFile) createBtn.setCta();
		createBtn.onClick(async () => {
			const target = await this.plugin.vaultLibrary.connectCandidateToVault({
				literatureFile: this.literatureFile,
				citekey: state.citekey,
				candidate,
				mode: 'create',
				appendEvidence: this.appendEvidence,
			});
			new Notice(`Created & linked Atomic Note: ${getBasename(target)}`);
			await this.notifyUpdated();
			await this.refreshState();
		});
	}

	private async notifyUpdated(): Promise<void> {
		if (this.onUpdated) {
			await this.onUpdated();
		}
	}
}
