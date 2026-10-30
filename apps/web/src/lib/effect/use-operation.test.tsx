import { StudyError } from '@study/contracts/errors';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import { expect, it } from 'vite-plus/test';

import { useOperation } from './use-operation';

it('loads data and exposes typed failures', async () => {
  const operation = Effect.succeed(42);
  const { result, rerender } = renderHook(({ key, operation }) => useOperation(key, operation), {
    initialProps: { key: 'one', operation: operation as Effect.Effect<number, StudyError> }
  });

  await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', value: 42 }));
  const error = new StudyError('auth', 'login');

  rerender({ key: 'two', operation: Effect.fail(error) });
  await waitFor(() => expect(result.current.state).toEqual({ status: 'error', error }));
});

it('cancels obsolete requests and never displays stale data for new inputs', async () => {
  let finish!: (value: number) => void;
  let oldSignal!: AbortSignal;
  const old = Effect.tryPromise({
    try: (signal) => {
      oldSignal = signal;

      return new Promise<number>((resolve) => {
        finish = resolve;
      });
    },
    catch: (cause) => new StudyError('transient', 'offline', { cause })
  });
  const { result, rerender } = renderHook(({ key, operation }) => useOperation(key, operation), {
    initialProps: { key: 'old', operation: old }
  });

  await waitFor(() => expect(finish).toBeDefined());
  rerender({ key: 'new', operation: Effect.succeed(2) });
  expect(oldSignal.aborted).toBe(true);
  await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', value: 2 }));
  await act(async () => {
    finish(1);
  });
  expect(result.current.state).toEqual({ status: 'ready', value: 2 });
});

it('aborts requests on unmount', async () => {
  let signal!: AbortSignal;
  const operation = Effect.tryPromise({
    try: (value) => {
      signal = value;

      return new Promise<never>(() => {});
    },
    catch: (cause) => new StudyError('transient', 'offline', { cause })
  });
  const { unmount } = renderHook(() => useOperation('request', operation));

  await waitFor(() => expect(signal).toBeDefined());
  unmount();
  expect(signal.aborted).toBe(true);
});

it('replaces data and cancels older refreshes after a committed mutation', async () => {
  let finish!: (value: number) => void;
  const operation = Effect.tryPromise({
    try: () =>
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    catch: (cause) => new StudyError('transient', 'offline', { cause })
  });
  const { result } = renderHook(() => useOperation('projects', operation));

  await waitFor(() => expect(finish).toBeDefined());
  act(() => result.current.replace(() => 7));
  await act(async () => {
    finish(1);
  });
  expect(result.current.state).toEqual({ status: 'ready', value: 7 });
});

it('keeps disabled operations idle without running them', () => {
  let started = false;
  const operation = Effect.sync(() => {
    started = true;
  });
  const { result } = renderHook(() => useOperation('disabled', undefined));

  expect(result.current.state).toEqual({ status: 'idle' });
  expect(started).toBe(false);
  void operation;
});

it('merges committed values with the most recently completed load', async () => {
  const operation = Effect.succeed([1]);
  const { result } = renderHook(() => useOperation('projects', operation));

  await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', value: [1] }));
  act(() => result.current.replace((items) => [...(items ?? []), 2]));
  expect(result.current.state).toEqual({ status: 'ready', value: [1, 2] });
});
