/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Supplies real scoped live-query services to native RPC test handler layers.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves runtime service requirements in standalone RPC fixtures.                     │
 * │ - Shares one real revision reconciler across composed handler groups.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Fixtures provide their own Database layer; no reactive behavior is mocked.               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { allDependencies } from '@study/contracts';
import { snapshotValues } from '@study/contracts/testing';
import { observeUntil } from '@study/testing/effect';
import { Effect } from 'effect';

import { LiveQueries, liveQueriesLayer } from '#server/platform/database/live-queries';

export const testLiveQueries = liveQueriesLayer();

/** Await a committed service state through the production revision subscription. */
export function awaitSnapshot<A, E, R>(read: Effect.Effect<A, E, R>, ready: (value: A) => boolean) {
  return Effect.gen(function* () {
    const queries = yield* LiveQueries;

    return yield* observeUntil(snapshotValues(queries.watch(allDependencies, read, true)), ready);
  }).pipe(Effect.provide(testLiveQueries));
}
