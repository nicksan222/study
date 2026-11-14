/** Scoped Effect atoms for live snapshots and independent, non-replayed mutations. */
import { useAtomRefresh, useAtomValue } from '@effect/atom-react';
import { Cause, Data, Effect, Exit, Option, Result, Schedule, Stream } from 'effect';
import { AsyncResult, Atom } from 'effect/reactivity';
import { createContext, useCallback, useContext, useRef, useState } from 'react';

import type { LiveFrame } from './protocol.ts';

export class SubscriptionTimeout extends Data.TaggedError('SubscriptionTimeout')<{}> {}

/** A remote defect is distinct from a declared domain failure and remains recoverable. */
export class SubscriptionDefect extends Data.TaggedError('SubscriptionDefect')<{
  readonly cause: unknown;
}> {}

/** An uncertain mutation defect is visible but never automatically replayed. */
export class MutationDefect extends Data.TaggedError('MutationDefect')<{
  readonly cause: unknown;
}> {}

function mutationExit<A, E>(exit: Exit.Exit<A, E>): Exit.Exit<A, E | MutationDefect> {
  if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) return exit;

  if (Option.isSome(Cause.findErrorOption(exit.cause))) return exit;

  return Exit.fail(new MutationDefect({ cause: Cause.squash(exit.cause) }));
}

export interface LivePolicy<E> {
  readonly livenessTimeoutMs: number;
  readonly reconnectDelayMs: number;
  readonly reconnectMaxDelayMs?: number;
  readonly retryable: (error: E | SubscriptionTimeout | SubscriptionDefect) => boolean;
  readonly unauthorized: (error: E | SubscriptionTimeout | SubscriptionDefect) => boolean;
}

export interface LiveState<A, E> {
  readonly result: AsyncResult.AsyncResult<A, E | SubscriptionTimeout | SubscriptionDefect>;
  readonly stale: boolean;
  readonly disconnected: boolean;
}

/** Atom owns continuous consumption; its scope cancels each connection before replacement. */
export function liveQueryAtom<A, E, TransportError = never>(
  open: () => Stream.Stream<LiveFrame<A, E>, TransportError>,
  policy: LivePolicy<E | TransportError>
) {
  type Failure = E | TransportError;

  const maxDelayMs = policy.reconnectMaxDelayMs ?? Math.max(30_000, policy.reconnectDelayMs);

  if (
    !Number.isFinite(maxDelayMs) ||
    maxDelayMs < policy.reconnectDelayMs ||
    !Number.isFinite(policy.livenessTimeoutMs) ||
    policy.livenessTimeoutMs <= 0 ||
    !Number.isFinite(policy.reconnectDelayMs) ||
    policy.reconnectDelayMs <= 0
  )
    throw new RangeError('live query intervals must be finite positive milliseconds');

  const states = (
    initial: Option.Option<
      AsyncResult.AsyncResult<A, Failure | SubscriptionTimeout | SubscriptionDefect>
    >
  ) =>
    Stream.suspend(() => {
      let previous = initial;
      let failures = 0;
      let retryingDomain = false;
      const attempt = Stream.suspend(() =>
        Stream.make({
          result: AsyncResult.waitingFrom(previous),
          stale: true,
          disconnected: false
        } satisfies LiveState<A, Failure>).pipe(
          Stream.concat(
            Stream.suspend(open).pipe(
              Stream.timeoutOrElse({
                duration: policy.livenessTimeoutMs,
                orElse: () => Stream.fail(new SubscriptionTimeout())
              }),
              Stream.concat(Stream.fail(new SubscriptionTimeout())),
              Stream.flatMap((frame): Stream.Stream<LiveState<A, Failure>, E> => {
                if (frame._tag === 'Heartbeat') return Stream.empty;

                if (frame._tag === 'Refreshing')
                  return Stream.make({
                    result: AsyncResult.waitingFrom(previous),
                    stale: true,
                    disconnected: false
                  });

                if (Result.isSuccess(frame.result)) {
                  failures = 0;
                  const result = AsyncResult.success<
                    A,
                    Failure | SubscriptionTimeout | SubscriptionDefect
                  >(frame.result.success);

                  previous = Option.some(result);

                  return Stream.make({ result, stale: false, disconnected: false });
                }

                const error = frame.result.failure;
                const result = AsyncResult.failWithPrevious<
                  A,
                  Failure | SubscriptionTimeout | SubscriptionDefect
                >(error, {
                  previous: policy.unauthorized(error) ? Option.none() : previous
                });

                previous = Option.some(result);
                const state: LiveState<A, Failure> = { result, stale: true, disconnected: false };

                if (policy.retryable(error)) {
                  retryingDomain = true;

                  return Stream.make(state).pipe(Stream.concat(Stream.fail(error)));
                }

                return Stream.make(state);
              }),
              Stream.catchCause((cause) => {
                if (Cause.hasInterruptsOnly(cause)) return Stream.failCause(cause);

                const typed = Cause.findErrorOption(cause);
                const error = Option.isSome(typed)
                  ? typed.value
                  : new SubscriptionDefect({ cause: Cause.squash(cause) });
                const failureCause = Option.isSome(typed) ? cause : Cause.fail(error);
                const denied = policy.unauthorized(error);
                const result = AsyncResult.failureWithPrevious(failureCause, {
                  previous: denied ? Option.none() : previous
                });

                previous = Option.some(result);
                failures++;
                const failed: LiveState<A, Failure> = {
                  result,
                  stale: true,
                  disconnected: !retryingDomain && !denied
                };

                retryingDomain = false;

                return Stream.make(failed).pipe(
                  Stream.concat(policy.retryable(error) ? Stream.fail(error) : Stream.never)
                );
              })
            )
          )
        )
      ).pipe(
        Stream.retry(
          Schedule.spaced(policy.reconnectDelayMs).pipe(
            Schedule.modifyDelay(() =>
              Effect.succeed(
                Math.min(maxDelayMs, policy.reconnectDelayMs * 2 ** Math.min(failures - 1, 16))
              )
            )
          )
        )
      );

      return attempt;
    });
  const source = Atom.make((get) => {
    const previous = Option.flatMap(
      get.self<AsyncResult.AsyncResult<LiveState<A, Failure>, never>>(),
      AsyncResult.value
    );

    return states(Option.map(previous, (state) => state.result));
  }).pipe(Atom.setIdleTTL(0));

  return Atom.map(source, (result): LiveState<A, Failure> =>
    Option.getOrElse(AsyncResult.value(result), () => ({
      result: AsyncResult.initial<A, Failure | SubscriptionTimeout | SubscriptionDefect>(true),
      stale: true,
      disconnected: false
    }))
  ).pipe(Atom.setIdleTTL(0));
}

export function useLiveQuery<A, E>(atom: Atom.Atom<LiveState<A, E>>) {
  const state = useAtomValue(atom);
  const retry = useAtomRefresh(atom);

  return { ...state, retry };
}

export const MutationContext = createContext<unknown>(undefined);

/** Every call runs a distinct scoped Effect; a failed response never triggers replay. */
export function useIndependentMutation<I, A, E>(invoke: (input: I) => Effect.Effect<A, E>) {
  const [result, setResult] = useState<AsyncResult.AsyncResult<A, E | MutationDefect>>(() =>
    AsyncResult.initial()
  );
  const [pending, setPending] = useState(0);
  const [variables, setVariables] = useState<I>();
  const sequence = useRef(0);
  const context = useContext(MutationContext);
  const contextRef = useRef(context);
  const generation = useRef(0);

  if (contextRef.current !== context) {
    contextRef.current = context;
    generation.current++;
    sequence.current++;
    setResult(AsyncResult.initial());
    setVariables(undefined);
    setPending(0);
  }

  const mutateAsync = useCallback(
    async (input: I): Promise<A> => {
      const identity = ++sequence.current;
      const ownerGeneration = generation.current;

      setVariables(() => input);
      setPending((count) => count + 1);
      setResult((previous) => AsyncResult.waiting(previous));

      try {
        const exit = mutationExit(
          await Effect.runPromiseExit(Effect.scoped(Effect.suspend(() => invoke(input))))
        );

        if (identity === sequence.current) setResult(AsyncResult.fromExit(exit));

        if (exit._tag === 'Failure') throw Cause.squash(exit.cause);

        return exit.value;
      } finally {
        if (ownerGeneration === generation.current) setPending((count) => count - 1);
      }
    },
    [invoke]
  );
  const mutate = useCallback(
    (input: I): Promise<A> => {
      const execution = mutateAsync(input);

      void execution.catch(() => {});

      return execution;
    },
    [mutateAsync]
  );
  const reset = useCallback(() => {
    sequence.current++;
    setResult(AsyncResult.initial());
    setVariables(undefined);
  }, []);

  return {
    result,
    pending,
    variables,
    mutate,
    mutateAsync,
    reset,
    data: Option.getOrUndefined(AsyncResult.value(result)),
    error: Option.getOrUndefined(AsyncResult.error(result)),
    isPending: pending > 0,
    isError: AsyncResult.isFailure(result),
    isSuccess: AsyncResult.isSuccess(result)
  };
}
