/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates local semantic retrieval through typed capabilities and durable        │
 * │ workflow resources.                                                                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves entity identities and keeps retrieval scoped and bounded.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature projections own visibility and runtime registration remains an explicit caller   │
 * │ decision.                                                                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { isRetryable } from '@study/contracts/errors';
import type { Failure } from '@study/contracts/errors';
import { Effect, Schedule } from 'effect';

import { recordSearchReconciliationRetry } from '#server/platform/observability/index';

/** Opt-in polling recovers missed change hints without installing a runtime worker. */
export function makeReconciliationLoop<A, R>(
  execute: (runId: string) => Effect.Effect<A, Failure, R>
) {
  const tick = Effect.suspend(() => execute(crypto.randomUUID())).pipe(
    Effect.asVoid,
    Effect.catch((failure) =>
      isRetryable(failure.kind)
        ? recordSearchReconciliationRetry(failure.kind)
        : Effect.fail(failure)
    )
  );

  return { tick, run: tick.pipe(Effect.repeat(Schedule.spaced('30 seconds')), Effect.asVoid) };
}
