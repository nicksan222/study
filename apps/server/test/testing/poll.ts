/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Repeats successful test observations with bounded native Effect scheduling.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves typed read failures and scoped interruption semantics.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Used by server tests; commands and domain assertions remain in their callers.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Effect, Schedule } from 'effect';
import type { Duration } from 'effect';
import { assert } from 'vite-plus/test';

/** Repeat successful observations while preserving RPC failures and interruption. */
export function pollUntil<A, E, R>(
  read: Effect.Effect<A, E, R>,
  ready: (value: A) => boolean,
  options: { attempts: number; interval: Duration.Input; message: string }
): Effect.Effect<A, E, R> {
  return Effect.repeat(read, {
    until: ready,
    times: options.attempts - 1,
    schedule: Schedule.spaced(options.interval)
  }).pipe(Effect.tap((value) => Effect.sync(() => assert.ok(ready(value), options.message))));
}
