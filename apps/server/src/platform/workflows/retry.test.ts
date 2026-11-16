import { StudyError } from '@study/contracts';
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
import { test } from '@study/testing';

import { retryDisposition } from '#server/platform/workflows/retry';

test.stable(
  'classifies workflow failures without retrying terminal errors',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

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
  }
);

test.stable(
  'shutdown interruption does not settle a terminal domain failure',
  async ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

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
  }
);
