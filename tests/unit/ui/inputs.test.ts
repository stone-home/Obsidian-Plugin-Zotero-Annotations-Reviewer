import { InputModal } from '../../../src/ui/inputs';
import { resetObsidianMocks } from '../../__mocks__/obsidian';
import { createTestApp, TestAppHarness } from '../../fixtures/vault';

describe('InputModal', () => {
	let harness: TestAppHarness;

	beforeEach(() => {
		resetObsidianMocks();
		harness = createTestApp();
	});

	it('marks border red and does not submit when citation key is empty or whitespace', () => {
		const onSubmit = jest.fn();
		const modal = new InputModal(harness.app, onSubmit);
		modal.open();

		const inputEl = modal.contentEl.querySelector('input') as HTMLInputElement;
		const submitBtn = modal.contentEl.querySelector('button') as HTMLButtonElement;
		expect(inputEl).not.toBeNull();
		expect(submitBtn.textContent).toBe('Review Highlights');

		inputEl.value = '   ';
		inputEl.dispatchEvent(new Event('input'));
		submitBtn.click();

		expect(onSubmit).not.toHaveBeenCalled();
		expect(inputEl.style.borderColor).toBe('red');
	});

	it('submits valid citation key via button click and cleans up on close', () => {
		const onSubmit = jest.fn();
		const modal = new InputModal(harness.app, onSubmit);
		modal.open();

		const inputEl = modal.contentEl.querySelector('input') as HTMLInputElement;
		const submitBtn = modal.contentEl.querySelector('button') as HTMLButtonElement;

		inputEl.value = 'vaswani2017';
		inputEl.dispatchEvent(new Event('input'));
		submitBtn.click();

		expect(onSubmit).toHaveBeenCalledWith('vaswani2017');
		expect(modal.contentEl.children).toHaveLength(0);
	});

	it('submits valid citation key when pressing Enter in the input field', () => {
		const onSubmit = jest.fn();
		const modal = new InputModal(harness.app, onSubmit);
		modal.open();

		const inputEl = modal.contentEl.querySelector('input') as HTMLInputElement;
		inputEl.value = 'dean2008';
		inputEl.dispatchEvent(new Event('input'));

		// Non-Enter key does nothing
		inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
		expect(onSubmit).not.toHaveBeenCalled();

		// Enter key submits
		const enterEvent = new KeyboardEvent('keydown', {
			key: 'Enter',
			cancelable: true,
		});
		inputEl.dispatchEvent(enterEvent);
		expect(enterEvent.defaultPrevented).toBe(true);
		expect(onSubmit).toHaveBeenCalledWith('dean2008');
	});
});
