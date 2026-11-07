import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { testStable } from '@study/testing/vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { useAgentProgress } from './use-agent-progress';

const api = vi.hoisted(() => ({ subscribe: vi.fn() }));

vi.mock('#web/lib/study-client/subscriptions.ts', () => ({ subscribe: api.subscribe }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

testStable('switching requests aborts the old viewer and ignores its late snapshots', async () => {
  const viewers: { receive: (runs: unknown) => void; signal: AbortSignal }[] = [];

  api.subscribe.mockImplementation((_invoke, receive, signal) => {
    viewers.push({ receive, signal });

    return new Promise(() => {});
  });
  const { result, rerender } = renderHook(
    ({ id }) => useAgentProgress({ executionId: executionIdSchema.make(id) }),
    { initialProps: { id: 'first' } }
  );

  rerender({ id: 'second' });
  expect(viewers[0]?.signal.aborted).toBe(true);
  await act(() => viewers[0]?.receive([{ text: 'old output' }]));
  expect(result.current.runs).toEqual([]);
  expect(result.current.key).toBe('execution:second');
});

testStable(
  'shows reconnecting honestly and accepts a fresh snapshot without stale output',
  async () => {
    let disconnected!: () => void;
    let receive!: (runs: unknown) => void;

    api.subscribe.mockImplementation((_invoke, onValue, _signal, onError) => {
      receive = onValue;
      disconnected = onError;

      return new Promise(() => {});
    });
    const { result } = renderHook(() => useAgentProgress({ correlationId: 'request' }));

    await act(() => disconnected());
    expect(result.current.connection).toBe('reconnecting');
    await act(() => receive([]));
    expect(result.current.connection).toBe('connected');
  }
);
