/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks workflow failures map to configuration waits, delayed retries, or terminal  │
 * │ failure by their typed StudyError kind.                                                  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: classifies workflow failures without retrying terminal errors.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes #server/platform/workflows/retry directly with node:test; no application or      │
 * │ database fixture is involved.                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/node';

import { retryDisposition } from '#server/platform/workflows/retry';

testStable('classifies workflow failures without retrying terminal errors', () => {
  for (const kind of ['auth', 'config', 'model_unavailable'] as const)
    assert.equal(retryDisposition(new StudyError(kind, 'test')), 'configuration');

  for (const kind of ['transient', 'rate_limited'] as const)
    assert.equal(retryDisposition(new StudyError(kind, 'test')), 'delayed');

  for (const kind of [
    'invalid_input',
    'unsupported',
    'cancelled',
    'internal',
    'not_found',
    'not_enough'
  ] as const)
    assert.equal(retryDisposition(new StudyError(kind, 'test')), 'terminal');
});
