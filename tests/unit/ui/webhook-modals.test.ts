import { WebhookProfile } from '../../../src/types';
import {
	WebhookInputValueModal,
	WebhookSelectionModal,
} from '../../../src/ui/webhook-modals';
import { resetObsidianMocks } from '../../__mocks__/obsidian';
import {
	clearOpenedModals,
	createTestApp,
	getLastOpenedModal,
	TestAppHarness,
} from '../../fixtures/vault';

describe('WebhookSelectionModal and WebhookInputValueModal', () => {
	let harness: TestAppHarness;

	const sampleHooks: WebhookProfile[] = [
		{
			id: 'wh-1',
			name: 'Synthesize Paper',
			icon: 'send',
			url: 'https://hooks.example.com/synth',
			method: 'POST',
			contentType: 'json',
			headers: [],
			bodyTemplate: '{"key":"{{citekey}}"}',
			hidden: false,
			inputVariables: [],
		},
		{
			id: 'wh-2',
			name: 'Custom Prompt Run',
			icon: 'zap',
			url: 'https://hooks.example.com/custom',
			method: 'POST',
			contentType: 'json',
			headers: [],
			bodyTemplate: '{"focus":"{{focus}}","budget":{{budget}}}',
			hidden: false,
			inputVariables: [
				{ name: 'focus', type: 'text' },
				{ name: 'budget', type: 'number' },
				{ name: '   ', type: 'text' },
			],
		},
	];

	beforeEach(() => {
		resetObsidianMocks();
		harness = createTestApp();
	});

	it('filters webhook suggestions case-insensitively and renders name and URL', () => {
		const onChoose = jest.fn();
		const modal = new WebhookSelectionModal(harness.app, sampleHooks, onChoose);

		expect(modal.getSuggestions('')).toHaveLength(2);
		expect(modal.getSuggestions('custom')).toEqual([sampleHooks[1]]);
		expect(modal.getSuggestions('NONEXISTENT')).toEqual([]);

		const itemEl = document.createElement('div');
		modal.renderSuggestion(sampleHooks[0], itemEl);
		expect(itemEl.textContent).toContain('Synthesize Paper');
		expect(itemEl.querySelector('.zotero-text-muted-italic')?.textContent).toBe(
			'https://hooks.example.com/synth'
		);
	});

	it('invokes onChoose directly without extraVariables when inputVariables is empty', () => {
		const onChoose = jest.fn();
		const modal = new WebhookSelectionModal(harness.app, sampleHooks, onChoose);
		modal.open();
		clearOpenedModals();

		modal.onChooseSuggestion(sampleHooks[0]);

		expect(onChoose).toHaveBeenCalledTimes(1);
		expect(onChoose).toHaveBeenCalledWith(sampleHooks[0]);
		expect(getLastOpenedModal()).toBeUndefined();
	});

	it('opens WebhookInputValueModal when inputVariables has named entries, coerces numbers, and handles Cancel vs Trigger', () => {
		const onChoose = jest.fn();
		const modal = new WebhookSelectionModal(harness.app, sampleHooks, onChoose);
		modal.open();
		clearOpenedModals();

		modal.onChooseSuggestion(sampleHooks[1]);
		const inputModal = getLastOpenedModal() as WebhookInputValueModal | undefined;
		expect(inputModal).toBeInstanceOf(WebhookInputValueModal);
		expect(onChoose).not.toHaveBeenCalled();

		const inputs = Array.from(
			inputModal!.contentEl.querySelectorAll('input')
		) as HTMLInputElement[];
		// Blank variable name was filtered out -> only 2 inputs
		expect(inputs).toHaveLength(2);
		expect(inputs[0].placeholder).toBe('Optional');
		expect(inputs[1].type).toBe('number');
		expect(inputs[1].placeholder).toBe('0');

		// Test Cancel button does not invoke onChoose
		const buttons = Array.from(
			inputModal!.contentEl.querySelectorAll('button')
		) as HTMLButtonElement[];
		const cancelBtn = buttons.find((b) => b.textContent === 'Cancel')!;
		cancelBtn.click();
		expect(onChoose).not.toHaveBeenCalled();

		// Re-open and test Trigger with text + number coercion (including empty number -> "0")
		const modal2 = new WebhookSelectionModal(harness.app, sampleHooks, onChoose);
		modal2.onChooseSuggestion(sampleHooks[1]);
		const inputModal2 = getLastOpenedModal<WebhookInputValueModal>()!;
		const inputs2 = Array.from(
			inputModal2.contentEl.querySelectorAll('input')
		) as HTMLInputElement[];

		inputs2[0].value = 'memory model';
		inputs2[0].dispatchEvent(new Event('input'));
		inputs2[1].value = '042';
		inputs2[1].dispatchEvent(new Event('input'));

		const triggerBtn = Array.from(
			inputModal2.contentEl.querySelectorAll('button')
		).find((b) => b.textContent === 'Trigger') as HTMLButtonElement;
		triggerBtn.click();

		expect(onChoose).toHaveBeenCalledTimes(1);
		expect(onChoose).toHaveBeenCalledWith(sampleHooks[1], {
			focus: 'memory model',
			budget: '42',
		});
	});
});
