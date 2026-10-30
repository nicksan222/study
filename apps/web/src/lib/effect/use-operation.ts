import type { StudyError } from '@study/contracts/errors';
import type { Effect } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';

import { runOperation } from './runtime';
import type { Outcome } from './runtime';

export type OperationState<A> =
  | { status: 'idle' | 'loading' }
  | Exclude<Outcome<A>, { status: 'cancelled' }>;

export function useOperation<A>(
  key: string,
  operation: Effect.Effect<A, StudyError> | undefined,
  refreshOnFocus = false
) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; state: OperationState<A> }>();
  const request = useRef<AbortController | undefined>(undefined);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!operation) return;

    const controller = new AbortController();

    request.current = controller;
    void runOperation(operation, controller.signal).then((state) => {
      if (!controller.signal.aborted && state.status !== 'cancelled') setResult({ key, state });
    });

    return () => controller.abort();
  }, [key, operation, revision]);

  useEffect(() => {
    if (!refreshOnFocus) return;

    window.addEventListener('focus', reload);

    return () => window.removeEventListener('focus', reload);
  }, [refreshOnFocus, reload]);

  const replace = useCallback(
    (update: (previous: A | undefined) => A) => {
      request.current?.abort();
      setResult((previous) => {
        const value =
          previous?.key === key && previous.state.status === 'ready'
            ? previous.state.value
            : undefined;

        return { key, state: { status: 'ready', value: update(value) } };
      });
    },
    [key]
  );
  const state: OperationState<A> = !operation
    ? { status: 'idle' }
    : result?.key === key
      ? result.state
      : { status: 'loading' };

  return { state, reload, replace };
}
