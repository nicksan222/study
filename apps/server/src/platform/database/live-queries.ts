/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Bridges persisted dependency revisions to scoped authoritative live RPC snapshots. │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns typed revision observation and lifetime checks.                                   │
 * │ - Preserves failures, successful snapshots and subscriber resource ownership.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ SQLite stays authoritative; official Effect scopes, queues and Reactivity own readers.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { Failure } from '@study/contracts';
import { allDependencies } from '@study/contracts';
import type { DependencyScope, LiveFrame } from '@study/contracts';
import type { Cause, Scope } from 'effect';
import {
  Clock,
  Context,
  Effect,
  Exit,
  Layer,
  PubSub,
  Queue,
  Result,
  Schedule,
  Stream
} from 'effect';
import { Reactivity } from 'effect/reactivity';

import { recordReactiveReconciliationFailure } from '#server/platform/observability/index';

import type { RevisionSnapshot } from './context.ts';
import { Database } from './database.ts';

export interface LiveQuerySettings {
  readonly reconciliationMs: number;
  readonly heartbeatMs?: number;
}

export class LiveQueries extends Context.Service<
  LiveQueries,
  {
    readonly watch: <A, E, R>(
      dependencies: readonly DependencyScope[],
      read: Effect.Effect<A, E, R>,
      external?: boolean
    ) => Stream.Stream<LiveFrame<A, E | Failure>, never, Exclude<R, Scope.Scope>>;
  }
>()('study/LiveQueries') {}

/** One reconciliation fiber per server; idle registries do no revision reads. */
export function liveQueriesLayer(settings: LiveQuerySettings = { reconciliationMs: 1_000 }) {
  if (
    !Number.isFinite(settings.reconciliationMs) ||
    settings.reconciliationMs < 10 ||
    settings.reconciliationMs > 60_000
  )
    throw new RangeError('reconciliationMs must be between 10 and 60000');

  const heartbeatMs = settings.heartbeatMs ?? 10_000;

  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 10 || heartbeatMs > 10_000)
    throw new RangeError('heartbeatMs must be between 10 and 10000');

  return Layer.effect(
    LiveQueries,
    Effect.gen(function* () {
      const { store } = yield* Database;
      const reactivity = yield* Reactivity.make;
      const heartbeats = yield* PubSub.sliding<LiveFrame<never, never>>(1);

      yield* Effect.addFinalizer(() => PubSub.shutdown(heartbeats));
      let lastHeartbeat = yield* Clock.currentTimeMillis;
      let subscribers = 0;
      let observed = store.revisions();
      const reconcile = () => {
        if (subscribers === 0) return;

        const current = store.revisions();
        const scopes = Object.keys(current.scopes) as DependencyScope[];
        const changed =
          current.generation !== observed.generation
            ? allDependencies
            : scopes.filter((scope) => current.scopes[scope] !== observed.scopes[scope]);

        observed = current;

        if (changed.length > 0) reactivity.invalidateUnsafe(changed);
      };

      yield* Effect.acquireRelease(
        Effect.sync(() => store.subscribe(reconcile)),
        (unsubscribe) => Effect.sync(unsubscribe)
      );
      yield* Effect.forkScoped(
        Effect.repeat(
          Effect.gen(function* () {
            yield* Effect.try({ try: reconcile, catch: (cause) => cause }).pipe(
              Effect.catchCause(() => recordReactiveReconciliationFailure())
            );

            if (subscribers === 0) return;

            reactivity.invalidateUnsafe(['external-refresh']);
            const now = yield* Clock.currentTimeMillis;

            if (now - lastHeartbeat >= heartbeatMs) {
              lastHeartbeat = now;
              yield* PubSub.publish(heartbeats, { _tag: 'Heartbeat' });
            }
          }),
          Schedule.spaced(Math.min(settings.reconciliationMs, heartbeatMs))
        )
      );

      const retainSubscriber = Effect.sync(() => {
        subscribers++;
      });
      const releaseSubscriber = () =>
        Effect.sync(() => {
          subscribers--;
        });

      return {
        watch: <A, E, R>(
          dependencies: readonly DependencyScope[],
          read: Effect.Effect<A, E, R>,
          external = false
        ) => {
          const readRevisions = Effect.try({
            try: () => store.revisions(),
            catch: (): Failure => ({
              kind: 'transient',
              message: 'Could not read committed revisions',
              retryAfterMs: null
            })
          });
          const consistent: Effect.Effect<Result.Result<A, E | Failure>, never, R> = Effect.suspend(
            () =>
              Effect.gen(function* () {
                const before = yield* readRevisions;
                const value = yield* Effect.result(read);
                const after = yield* readRevisions;

                if (before.generation === after.generation && covered(dependencies, before, after))
                  return value;

                yield* Effect.yieldNow;

                return yield* consistent;
              }).pipe(Effect.result, Effect.map(flattenSnapshotResult))
          );

          return Stream.unwrap(
            Effect.gen(function* () {
              yield* Effect.acquireRelease(retainSubscriber, releaseSubscriber);

              const frames = yield* Queue.sliding<LiveFrame<A, E | Failure>, Cause.Done>(2);

              yield* Effect.addFinalizer(() => Queue.end(frames));
              const publishRead = Effect.gen(function* () {
                yield* Queue.offer(frames, { _tag: 'Refreshing' });
                const result = yield* consistent;

                yield* Queue.offer(frames, { _tag: 'Snapshot', result });
              });

              // Reactivity registers before running publishRead and coalesces racing invalidations.
              yield* Effect.forkScoped(
                reactivity
                  .stream(
                    external ? [...dependencies, 'external-refresh'] : dependencies,
                    publishRead
                  )
                  .pipe(
                    Stream.runDrain,
                    Effect.onExit((exit) =>
                      Exit.isFailure(exit) ? Queue.failCause(frames, exit.cause) : Effect.void
                    )
                  )
              );

              return Stream.fromQueue(frames).pipe(Stream.merge(Stream.fromPubSub(heartbeats)));
            })
          );
        }
      };
    })
  );
}

function covered(
  dependencies: readonly DependencyScope[],
  before: RevisionSnapshot,
  after: RevisionSnapshot
) {
  return dependencies.every((scope) => before.scopes[scope] === after.scopes[scope]);
}

function flattenSnapshotResult<A, E>(
  result: Result.Result<Result.Result<A, E>, Failure>
): Result.Result<A, E | Failure> {
  return result._tag === 'Success' ? result.success : Result.fail(result.failure);
}
