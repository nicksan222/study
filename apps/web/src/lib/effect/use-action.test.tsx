import { act, renderHook, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import { expect, it } from 'vite-plus/test';

import { useAction } from './use-action';

it('owns mutation lifetime and prevents duplicate submissions', async () => {
  const { result, unmount } = renderHook(() => useAction());
  let started = 0;
  let signal!: AbortSignal;
  const operation = Effect.promise((value) => {
    started++;
    signal = value;

    return new Promise<never>(() => {});
  });
  let pending!: ReturnType<typeof result.current.run>;

  act(() => {
    pending = result.current.run(operation);
  });
  await waitFor(() => expect(result.current.pending).toBe(true));
  expect(await result.current.run(operation)).toEqual({ status: 'cancelled' });
  expect(started).toBe(1);
  unmount();
  expect(signal.aborted).toBe(true);
  expect(await pending).toEqual({ status: 'cancelled' });
});
