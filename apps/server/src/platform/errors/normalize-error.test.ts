/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks domain error identity and retry metadata survive normalization, while       │
 * │ unknown causes receive safe public messages and retain their private cause.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: normalization preserves domain failure identity and retry metadata;           │
 * │   normalization classifies unknown causes without exposing their messages.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Invokes #server/platform/errors/classify-error directly with node:test; no application   │
 * │ or database fixture is involved.                                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { StudyError } from '@study/contracts/errors';
import { testStable } from '@study/testing/node';

import { normalizeError } from '#server/platform/errors/classify-error';

testStable('normalization preserves domain failure identity and retry metadata', () => {
  const cause = new Error('provider');
  const failure = new StudyError('rate_limited', 'slow down', { cause, retryAfterMs: 42 });

  assert.equal(normalizeError(failure), failure);
  assert.equal(normalizeError(failure).cause, cause);
});

testStable('normalization classifies unknown causes without exposing their messages', () => {
  const cause = Object.assign(new Error('private path'), { code: 'EACCES' });
  const failure = normalizeError(cause);

  assert.equal(failure.kind, 'config');
  assert.equal(failure.message, 'Required resource is not accessible');
  assert.equal(failure.cause, cause);
  assert.equal(failure.retryAfterMs, null);
});
