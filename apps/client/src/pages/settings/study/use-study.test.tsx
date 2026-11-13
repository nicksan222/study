import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, vi } from 'vite-plus/test';

import { useStudySettings } from './use-study';

const api = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));

vi.mock('#client/lib/study-client/preferences.ts', () => ({
  loadReviewSettings: api.load,
  saveReviewSettings: api.save
}));

beforeEach(() => {
  api.load.mockReset().mockResolvedValue({ newCardsPerDay: 20 });
  api.save.mockReset().mockResolvedValue({});
});

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });

  return renderHook(() => useStudySettings(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
  });
}

testStable(
  'rejects empty, fractional and out-of-range values without sending a request',
  async () => {
    const { result } = setup();

    await waitFor(() => expect(result.current.draft).toBe('20'));

    for (const value of ['', '-1', '1.5', '10001']) {
      act(() => result.current.setDraft(value));
      expect(result.current.valid).toBe(false);
      act(() => result.current.save());
    }

    expect(api.save).not.toHaveBeenCalled();
  }
);

testStable('saves zero and reloads the committed allowance', async () => {
  const { result } = setup();

  await waitFor(() => expect(result.current.draft).toBe('20'));
  api.load.mockResolvedValue({ newCardsPerDay: 0 });
  act(() => result.current.setDraft('0'));
  act(() => result.current.save());
  await waitFor(() => expect(api.save).toHaveBeenCalledWith({ newCardsPerDay: 0 }));
  await waitFor(() => expect(result.current.data?.newCardsPerDay).toBe(0));
  expect(result.current.changed).toBe(false);
});

testStable('restores the saved allowance on failure and recovers by retrying', async () => {
  const { result } = setup();

  await waitFor(() => expect(result.current.draft).toBe('20'));
  api.save.mockRejectedValue(new Error('offline'));
  act(() => result.current.setDraft('30'));
  act(() => result.current.save());
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.draft).toBe('20');
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.error).toBe(false));
});
