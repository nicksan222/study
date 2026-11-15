/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Serializes domain cancellation intent against official durable dispatch            │
 * │ acceptance.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exposes a scoped local permit for the acceptance boundary.                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This serializes admission; official Effect services own execution and recovery.          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { Effect } from 'effect';
import { Semaphore } from 'effect';

import type { ServerContext } from '#server/platform/database/context';

const dispatchPermits = new WeakMap<ServerContext, Semaphore.Semaphore>();

/** Serializes local cancellation against the cross-connection acceptance boundary. */
export function withDispatchPermit<A, E, R>(
  context: ServerContext,
  effect: Effect.Effect<A, E, R>
) {
  let permit = dispatchPermits.get(context);

  if (!permit) {
    permit = Semaphore.makeUnsafe(1);
    dispatchPermits.set(context, permit);
  }

  return permit.withPermit(effect);
}
