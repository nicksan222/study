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

import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';

import { makeReconciliationLoop } from './reconciliation.ts';

testStable('a busy local model does not stop subsequent automatic reconciliation', async () => {
  let calls = 0;
  const runIds = new Set<string>();
  const loop = makeReconciliationLoop((runId) =>
    Effect.suspend(() => {
      runIds.add(runId);

      return ++calls === 1
        ? Effect.fail(new StudyError('transient', 'busy'))
        : Effect.succeed(undefined);
    })
  );

  await Effect.runPromise(loop.tick);
  await Effect.runPromise(loop.tick);
  expect(calls).toBe(2);
  expect(runIds.size).toBe(2);
});
