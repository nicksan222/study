/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Provides server clock helpers for constructing the live Effect clock and           │
 * │ converting its readings. SQLite timestamps use Unix seconds while workflow timing uses   │
 * │ milliseconds and monotonic durations.                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports liveClock, unixSeconds, elapsedMillis. SQLite timestamps use Unix seconds      │
 * │   while workflow timing uses milliseconds and monotonic durations.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ ServerContext and workflow code use the supplied Effect Clock; each caller chooses Unix  │
 * │ seconds or monotonic duration.                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { Clock, Context } from 'effect';

/** Resolve Effect's live default when constructing a synchronous boundary outside a fiber. */
export function liveClock(): Clock.Clock {
  return Context.get(Context.empty(), Clock.Clock);
}

/** SQLite timestamps use integer Unix seconds; workflow checkpoints use milliseconds. */
export function unixSeconds(clock: Clock.Clock): bigint {
  return BigInt(Math.floor(clock.currentTimeMillisUnsafe() / 1000));
}

/** Monotonic elapsed milliseconds from a reading on the same native clock. */
export function elapsedMillis(clock: Clock.Clock, startedNanos: bigint): number {
  return Number(clock.monotonicTimeNanosUnsafe() - startedNanos) / 1_000_000;
}
