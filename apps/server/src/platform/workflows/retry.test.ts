/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks workflow failures map to configuration waits, delayed retries, or terminal  │
 * │ failure by their typed StudyError kind.                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: classifies workflow failures without retrying terminal errors.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes #server/platform/workflows/retry directly with Vitest   ; no application or      │
 * │ database fixture is involved.                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/vitest';
import { assert } from 'vite-plus/test';

import { retryDisposition } from '#server/platform/workflows/retry';

testStable('classifies workflow failures without retrying terminal errors', () => {
  for (const kind of ['auth', 'config', 'model_unavailable'] as const)
    assert.ok(retryDisposition(new StudyError(kind, 'test')) === 'configuration');

  for (const kind of ['transient', 'rate_limited'] as const)
    assert.ok(retryDisposition(new StudyError(kind, 'test')) === 'delayed');

  for (const kind of [
    'invalid_input',
    'unsupported',
    'cancelled',
    'internal',
    'not_found',
    'not_enough'
  ] as const)
    assert.ok(retryDisposition(new StudyError(kind, 'test')) === 'terminal');
});

testStable('shutdown interruption does not settle a terminal domain failure', async () => {
  const { Cause, Effect, Exit } = await import('effect');
  const { settleWorkflowFailure } = await import('#server/platform/workflows/retry');
  let settled = false;
  const interrupted = await Effect.runPromiseExit(Effect.interrupt);

  const interruption = Exit.match(interrupted, {
    onFailure: (cause) => cause,
    onSuccess: () => assert.fail('Expected interruption')
  });
  const outcome = await Effect.runPromiseExit(
    settleWorkflowFailure(interruption, 'failed', () =>
      Effect.sync(() => {
        settled = true;
      })
    )
  );

  assert.ok(Exit.isFailure(outcome) && Cause.hasInterrupts(outcome.cause));
  assert.ok(!settled);
});
