import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';

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
    retry: vi.fn(),
    setDraft: vi.fn(),
    save: vi.fn()
  };
}

it('exposes the actual integer bounds and leaves unchanged settings unsaved', () => {
  const state = model();

  render(<StudySettingsView model={state} />);
  const input = screen.getByRole('spinbutton', { name: 'New cards per day' });

  expect(input).toHaveAttribute('min', '0');
  expect(input).toHaveAttribute('max', '10000');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  fireEvent.change(input, { target: { value: '0' } });
  expect(state.setDraft).toHaveBeenCalledWith('0');
});

it('shows an actionable validation message and prevents invalid saves', () => {
  render(<StudySettingsView model={{ ...model(), draft: '1.5', valid: false, changed: true }} />);
  expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('alert')).toHaveTextContent('whole number from 0 to 10,000');
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
});

it('submits a valid changed value with Enter and links validation to its field', () => {
  const state = { ...model(), draft: '0', changed: true };
  const { rerender } = render(<StudySettingsView model={state} />);
  const input = screen.getByRole('spinbutton');

  fireEvent.submit(input.closest('form')!);
  expect(state.save).toHaveBeenCalledOnce();
  rerender(<StudySettingsView model={{ ...state, valid: false }} />);
  expect(input).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
});
