import { Effect, Option, Schedule, Stream } from 'effect';
import type { Duration, Scope } from 'effect';

import { testPolicy } from './config.ts';

/** Real wall-clock deadlines do not advance or constrain Effect's virtual test clock. */
export function runTestEffect<A, E>(
  effect: Effect.Effect<A, E, Scope.Scope>,
  options: { signal?: AbortSignal; timeout?: number } = {}
): Promise<A> {
  const deadline = AbortSignal.timeout(options.timeout ?? testPolicy.asyncTimeout);

  return Effect.runPromise(Effect.scoped(effect), {
    signal: options.signal ? AbortSignal.any([options.signal, deadline]) : deadline
  });
}

/** Observe a real stream until a matching state; failures and subscription finalizers remain live. */
export function observeUntil<A, E, R>(
  stream: Stream.Stream<A, E, R>,
  ready: (value: A) => boolean
) {
  return stream.pipe(
    Stream.filter(ready),
    Stream.runHead,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.die(new Error('Observation ended before matching')),
        onSome: Effect.succeed
      })
    )
  );
}

/** Explicit bounded observation for external engines without a subscription; never retry read failures. */
type PollOptions = { attempts: number; interval: Duration.Input; message: string };

export function pollUntil<A, B extends A, E, R>(
  read: Effect.Effect<A, E, R>,
  ready: (value: A) => value is B,
  options: PollOptions
): Effect.Effect<B, E, R>;

export function pollUntil<A, E, R>(
  read: Effect.Effect<A, E, R>,
  ready: (value: A) => boolean,
  options: PollOptions
): Effect.Effect<A, E, R>;

export function pollUntil<A, E, R>(
  read: Effect.Effect<A, E, R>,
  ready: (value: A) => boolean,
  options: PollOptions
): Effect.Effect<A, E, R> {
  return Effect.repeat(read, {
    until: ready,
    times: options.attempts - 1,
    schedule: Schedule.spaced(options.interval)
  }).pipe(
    Effect.flatMap((value) =>
      ready(value) ? Effect.succeed(value) : Effect.die(new Error(options.message))
    )
  );
}
