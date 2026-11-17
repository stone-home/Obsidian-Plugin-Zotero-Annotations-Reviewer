import { App, ButtonComponent, Modal, SuggestModal, TextComponent } from 'obsidian';
import { WebhookInputVariable, WebhookProfile } from '../types';

export class WebhookSelectionModal extends SuggestModal<WebhookProfile> {
	webhooks: WebhookProfile[];
	onChoose: (hook: WebhookProfile, extraVariables?: Record<string, string>) => void;

	constructor(
		app: App,
		webhooks: WebhookProfile[],
		onChoose: (
			hook: WebhookProfile,
			extraVariables?: Record<string, string>
		) => void
	) {
		super(app);
		this.webhooks = webhooks;
		this.onChoose = onChoose;
	}

	getSuggestions(query: string): WebhookProfile[] {
		return this.webhooks.filter((hook) =>
			hook.name.toLowerCase().includes(query.toLowerCase())
		);
	}

	renderSuggestion(hook: WebhookProfile, el: HTMLElement): void {
		el.createDiv({ text: hook.name });
		el.createDiv({ text: hook.url, cls: 'zotero-text-muted-italic' });
	}

	onChooseSuggestion(hook: WebhookProfile): void {
		this.close();
		const vars = (hook.inputVariables ?? []).filter((iv) => iv.name?.trim());
		if (vars.length > 0) {
			new WebhookInputValueModal(this.app, hook.name, vars, (values) => {
				this.onChoose(hook, values);
			}).open();
		} else {
			this.onChoose(hook);
		}
	}
}

/** Asks for input values when the webhook has inputVariables configured. */
export class WebhookInputValueModal extends Modal {
	title: string;
	variables: WebhookInputVariable[];
	onSubmit: (values: Record<string, string>) => void;
	private inputs: Map<string, TextComponent> = new Map();

	constructor(
		app: App,
		title: string,
		variables: WebhookInputVariable[],
		onSubmit: (values: Record<string, string>) => void
	) {
		super(app);
		this.title = title;
		this.variables = variables;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('zotero-webhook-input-modal');
		contentEl.createEl('h2', {
			text: this.title,
			cls: 'zotero-webhook-input-title',
		});
		const desc = contentEl.createDiv({ cls: 'zotero-webhook-input-desc' });
		desc.setText('Enter values to substitute in the webhook body.');
		const form = contentEl.createDiv({ cls: 'zotero-webhook-input-form' });
		this.variables.forEach((iv) => {
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
				tc.setPlaceholder('Optional');
			}
			this.inputs.set(iv.name, tc);
		});
		const footer = contentEl.createDiv({ cls: 'zotero-webhook-input-footer' });
		new ButtonComponent(footer).setButtonText('Cancel').onClick(() => this.close());
		new ButtonComponent(footer)
			.setButtonText('Trigger')
			.setCta()
			.onClick(() => {
				const values: Record<string, string> = {};
				this.variables.forEach((iv) => {
					const v = this.inputs.get(iv.name)?.getValue() ?? '';
					values[iv.name] = iv.type === 'number' ? String(Number(v)) : v;
				});
				this.close();
				this.onSubmit(values);
			})
			.buttonEl.addClass('zotero-btn-fancy');
	}
}
