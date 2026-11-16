import { test } from '@study/testing';

import { StudySettingsView } from './study.view';

function model({ vi }: Pick<test.Context, 'vi'>) {
  return {
    data: { newCardsPerDay: 20 },
    draft: '20',
    valid: true,
    changed: false,
    loading: false,
    pending: false,
    error: false,
    retry: vi.fn(),
    setDraft: vi.fn(),
    save: vi.fn()
  };
}

test.stable(
  'exposes the actual integer bounds and leaves unchanged settings unsaved',
  ({ render, screen, expect, fireEvent, vi }) => {
    const state = model({ vi });

    render(<StudySettingsView model={state} />);
    const input = screen.getByRole('spinbutton', { name: 'New cards per day' });

    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '10000');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '0' } });
    expect(state.setDraft).toHaveBeenCalledWith('0');
  }
);

test.stable(
  'shows an actionable validation message and prevents invalid saves',
  ({ render, expect, screen, vi }) => {
    render(
      <StudySettingsView model={{ ...model({ vi }), draft: '1.5', valid: false, changed: true }} />
    );
    expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('whole number from 0 to 10,000');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  }
);

test.stable(
  'submits a valid changed value with Enter and links validation to its field',
  ({ render, screen, fireEvent, expect, vi }) => {
    const state = { ...model({ vi }), draft: '0', changed: true };
    const { rerender } = render(<StudySettingsView model={state} />);
    const input = screen.getByRole('spinbutton');

    fireEvent.submit(input.closest('form')!);
    expect(state.save).toHaveBeenCalledOnce();
    rerender(<StudySettingsView model={{ ...state, valid: false }} />);
    expect(input).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
  }
);
