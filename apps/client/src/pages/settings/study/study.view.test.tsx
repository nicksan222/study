import { test } from '@study/testing';

import { StudySettingsView } from './study.view';

function model() {
  return {
    data: { newCardsPerDay: 20 },
    draft: '20',
    valid: true,
    changed: false,
    loading: false,
    pending: false,
    error: false,
    retry: test.vi.fn(),
    setDraft: test.vi.fn(),
    save: test.vi.fn()
  };
}

test.stable('exposes the actual integer bounds and leaves unchanged settings unsaved', () => {
  const state = model();

  test.render(<StudySettingsView model={state} />);
  const input = test.screen.getByRole('spinbutton', { name: 'New cards per day' });

  test.expect(input).toHaveAttribute('min', '0');
  test.expect(input).toHaveAttribute('max', '10000');
  test.expect(test.screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  test.fireEvent.change(input, { target: { value: '0' } });
  test.expect(state.setDraft).toHaveBeenCalledWith('0');
});

test.stable('shows an actionable validation message and prevents invalid saves', () => {
  test.render(
    <StudySettingsView model={{ ...model(), draft: '1.5', valid: false, changed: true }} />
  );
  test.expect(test.screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid', 'true');
  test.expect(test.screen.getByRole('alert')).toHaveTextContent('whole number from 0 to 10,000');
  test.expect(test.screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test.stable('submits a valid changed value with Enter and links validation to its field', () => {
  const state = { ...model(), draft: '0', changed: true };
  const { rerender } = test.render(<StudySettingsView model={state} />);
  const input = test.screen.getByRole('spinbutton');

  test.fireEvent.submit(input.closest('form')!);
  test.expect(state.save).toHaveBeenCalledOnce();
  rerender(<StudySettingsView model={{ ...state, valid: false }} />);
  test.expect(input).toHaveAttribute('aria-describedby', test.screen.getByRole('alert').id);
});
