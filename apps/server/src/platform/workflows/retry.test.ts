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
