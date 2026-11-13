import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { testStable } from '@study/testing/vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { useAgentProgress } from './use-agent-progress';

const api = vi.hoisted(() => ({ subscribe: vi.fn() }));

vi.mock('#client/lib/study-client/subscriptions.ts', () => ({ subscribe: api.subscribe }));
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

testStable('accepts replacement snapshots without exposing feature connection state', async () => {
  let receive!: (runs: unknown) => void;

  api.subscribe.mockImplementation((_invoke, onValue) => {
    receive = onValue;

    return new Promise(() => {});
  });
  const { result } = renderHook(() => useAgentProgress({ correlationId: 'request' }));

  await act(() => receive([]));
  expect(result.current.runs).toEqual([]);
  expect(result.current).not.toHaveProperty('connection');
});
