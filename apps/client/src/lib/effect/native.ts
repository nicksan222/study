/** Scoped asynchronous host operations; state stays local to the mounted caller. */
import { Cause, Effect, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useCallback, useEffect, useRef, useState } from 'react';

import { runNativeExit } from './runtime.ts';

export function useNativeAsync<A>(run: () => Promise<A>, enabled = true) {
  const [result, setResult] = useState<AsyncResult.AsyncResult<A, unknown>>(() =>
    AsyncResult.initial(enabled)
  );
  const current = useRef(run);

  current.current = run;
  const lifecycle = useRef<{ sequence: number; active: AbortController | undefined }>({
    sequence: 0,
    active: undefined
  });
  const state = lifecycle.current;
  const refetch = useCallback(async () => {
    const identity = ++state.sequence;

    state.active?.abort();
    const controller = new AbortController();

    state.active = controller;
    setResult((previous) => AsyncResult.waiting(previous));
    const exit = await runNativeExit(
      Effect.tryPromise({ try: () => current.current(), catch: (error) => error }),
      controller.signal
    );

    if (identity === state.sequence)
      setResult((previous) => AsyncResult.fromExitWithPrevious(exit, Option.some(previous)));

    return exit._tag === 'Success' ? exit.value : undefined;
  }, [state]);

  useEffect(() => {
    let mounted = true;

    if (enabled)
      void Promise.resolve().then(() => {
        if (mounted) return refetch();
      });

    return () => {
      mounted = false;
      state.sequence++;
      state.active?.abort();
    };
  }, [enabled, refetch, state]);

  return {
    result,
    data: Option.getOrUndefined(AsyncResult.value(result)),
    error: result._tag === 'Failure' ? Cause.squash(result.cause) : undefined,
    isPending: result._tag === 'Initial',
    isFetching: result.waiting,
    isError: result._tag === 'Failure',
    isSuccess: result._tag === 'Success',
    refetch,
    reset: () => setResult(AsyncResult.initial())
  };
}

export function useNativeAction<I, A>(run: (input: I) => Promise<A>) {
  const [result, setResult] = useState<AsyncResult.AsyncResult<A, unknown>>(() =>
    AsyncResult.initial()
  );
  const [pending, setPending] = useState(0);
  const identity = useRef(0);
  const runRef = useRef(run);

  runRef.current = run;
  const mutateAsync = useCallback(async (input: I) => {
    const execution = ++identity.current;

    setPending((value) => value + 1);
    setResult((previous) => AsyncResult.waiting(previous));

    try {
      const exit = await runNativeExit(
        Effect.tryPromise({ try: () => runRef.current(input), catch: (error) => error })
      );

      if (execution === identity.current) setResult(AsyncResult.fromExit(exit));

      if (exit._tag === 'Failure') throw Cause.squash(exit.cause);

      return exit.value;
    } finally {
      setPending((value) => value - 1);
    }
  }, []);

  return {
    result,
    pending,
    isPending: pending > 0,
    isError: result._tag === 'Failure',
    isSuccess: result._tag === 'Success',
    error: result._tag === 'Failure' ? Cause.squash(result.cause) : undefined,
    data: Option.getOrUndefined(AsyncResult.value(result)),
    mutateAsync,
    mutate: (input: I) => {
      void mutateAsync(input).catch(() => {});
    },
    reset: () => setResult(AsyncResult.initial())
  };
}

export { microphoneAvailable, captureMicrophone } from './microphone.ts';
export type { MicrophoneCapture } from './microphone.ts';
