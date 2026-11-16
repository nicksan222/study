import { test } from '@study/testing';

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
      setValue: test.vi.fn(),
      save: test.vi.fn()
    },
    queued: {
      min: 0 as const,
      max: 64 as const,
      value: '16',
      valid: true,
      changed: false,
      setValue: test.vi.fn(),
      save: test.vi.fn()
    },
    loading: false,
    pending: false,
    error: false,
    retry: test.vi.fn()
  };
}

test.stable('exposes both limits with bounds and disables unchanged saves', () => {
  test.render(<PerformanceSettingsView model={model()} />);
  const active = test.screen.getByRole('spinbutton', { name: 'Concurrent AI requests' });
  const queued = test.screen.getByRole('spinbutton', { name: 'Waiting AI requests' });

  test.expect(active).toHaveAttribute('min', '1');
  test.expect(active).toHaveAttribute('max', '8');
  test.expect(queued).toHaveAttribute('min', '0');
  test.expect(queued).toHaveAttribute('max', '64');
  test
    .expect(
      test.screen
        .getAllByRole('button', { name: 'Save' })
        .every((button) => button.hasAttribute('disabled'))
    )
    .toBe(true);
});

test.stable('submits a changed setting through its form and links validation to the input', () => {
  const state = model();

  state.active.changed = true;
  const { rerender } = test.render(<PerformanceSettingsView model={state} />);
  const input = test.screen.getByRole('spinbutton', { name: 'Concurrent AI requests' });

  test.fireEvent.submit(input.closest('form')!);
  test.expect(state.active.save).toHaveBeenCalledOnce();
  rerender(
    <PerformanceSettingsView
      model={{ ...state, active: { ...state.active, valid: false, value: '0' } }}
    />
  );
  test.expect(input).toHaveAttribute('aria-invalid', 'true');
  test.expect(input).toHaveAttribute('aria-describedby', test.screen.getByRole('alert').id);
});

test.stable('offers retry after a load failure', () => {
  const state = { ...model(), data: undefined, error: true };

  test.render(<PerformanceSettingsView model={state} />);
  test.fireEvent.click(test.screen.getByRole('button', { name: 'Retry' }));
  test.expect(state.retry).toHaveBeenCalledOnce();
});
