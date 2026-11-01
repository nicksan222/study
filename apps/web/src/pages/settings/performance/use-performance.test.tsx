import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { usePerformanceSettings } from './use-performance';

const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));

vi.mock('../../../lib/study-client/concurrency', () => ({
  loadConcurrencySettings: api.load,
  saveConcurrencySettings: api.save
}));

beforeEach(() => {
  api.load.mockReset().mockResolvedValue({ maxConcurrentAi: 2, maxQueuedAi: 16 });
  api.save.mockReset().mockResolvedValue({});
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return renderHook(() => usePerformanceSettings(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
  });
}

it('rejects invalid active and queue limits without sending a request', async () => {
  const { result } = setup();

  await waitFor(() => expect(result.current.active.value).toBe('2'));

  for (const value of ['', '0', '1.5', '9']) {
    act(() => result.current.active.setValue(value));
    expect(result.current.active.valid).toBe(false);
    act(() => result.current.active.save());
  }

  for (const value of ['', '-1', '2.5', '65']) {
    act(() => result.current.queued.setValue(value));
    expect(result.current.queued.valid).toBe(false);
    act(() => result.current.queued.save());
  }

  expect(api.save).not.toHaveBeenCalled();
});

it('saves zero queue capacity while preserving active capacity and its unsaved draft', async () => {
  const { result } = setup();

  await waitFor(() => expect(result.current.queued.value).toBe('16'));
  act(() => result.current.active.setValue('8'));
  act(() => result.current.queued.setValue('0'));
  api.load.mockResolvedValue({ maxConcurrentAi: 2, maxQueuedAi: 0 });
  act(() => result.current.queued.save());
  await waitFor(() =>
    expect(api.save).toHaveBeenCalledWith({ maxConcurrentAi: 2, maxQueuedAi: 0 })
  );
  await waitFor(() => expect(result.current.data?.maxQueuedAi).toBe(0));
  expect(result.current.queued.changed).toBe(false);
  expect(result.current.active.value).toBe('8');
});

it('does not save unchanged values and rolls back a failed save before retry', async () => {
  const { result } = setup();

  await waitFor(() => expect(result.current.active.value).toBe('2'));
  act(() => result.current.active.save());
  expect(api.save).not.toHaveBeenCalled();
  api.save.mockRejectedValue(new Error('offline'));
  act(() => result.current.active.setValue('1'));
  act(() => result.current.active.save());
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.active.value).toBe('2');
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.error).toBe(false));
});

it('exposes loading failures and retries to recover saved limits', async () => {
  api.load.mockRejectedValueOnce(new Error('offline'));
  const { result } = setup();

  await waitFor(() => expect(result.current.error).toBe(true));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.active.value).toBe('2'));
  expect(result.current.error).toBe(false);
});
