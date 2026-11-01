import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';

import { PerformanceSettingsView } from './performance.view';

function model() {
  return {
    data: { maxConcurrentAi: 2, maxQueuedAi: 16 },
    active: {
      min: 1 as const,
      max: 8 as const,
      value: '2',
      valid: true,
      changed: false,
      setValue: vi.fn(),
      save: vi.fn()
    },
    queued: {
      min: 0 as const,
      max: 64 as const,
      value: '16',
      valid: true,
      changed: false,
      setValue: vi.fn(),
      save: vi.fn()
    },
    loading: false,
    pending: false,
    error: false,
    retry: vi.fn()
  };
}

it('exposes both limits with bounds and disables unchanged saves', () => {
  render(<PerformanceSettingsView model={model()} />);
  const active = screen.getByRole('spinbutton', { name: 'Concurrent AI requests' });
  const queued = screen.getByRole('spinbutton', { name: 'Waiting AI requests' });

  expect(active).toHaveAttribute('min', '1');
  expect(active).toHaveAttribute('max', '8');
  expect(queued).toHaveAttribute('min', '0');
  expect(queued).toHaveAttribute('max', '64');
  expect(
    screen
      .getAllByRole('button', { name: 'Save' })
      .every((button) => button.hasAttribute('disabled'))
  ).toBe(true);
});

it('submits a changed setting through its form and links validation to the input', () => {
  const state = model();

  state.active.changed = true;
  const { rerender } = render(<PerformanceSettingsView model={state} />);
  const input = screen.getByRole('spinbutton', { name: 'Concurrent AI requests' });

  fireEvent.submit(input.closest('form')!);
  expect(state.active.save).toHaveBeenCalledOnce();
  rerender(
    <PerformanceSettingsView
      model={{ ...state, active: { ...state.active, valid: false, value: '0' } }}
    />
  );
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAttribute('aria-describedby', screen.getByRole('alert').id);
});

it('offers retry after a load failure', () => {
  const state = { ...model(), data: undefined, error: true };

  render(<PerformanceSettingsView model={state} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(state.retry).toHaveBeenCalledOnce();
});
