import { StudyError } from '@study/contracts';
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
 * │ Invokes #server/platform/errors/classify-error directly with Vitest   ; no application   │
 * │ or database fixture is involved.                                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { test } from '@study/testing';

import { normalizeError } from '#server/platform/errors/classify-error';

test.unit.stable(
  'normalization preserves domain failure identity and retry metadata',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const cause = new Error('provider');
    const failure = new StudyError('rate_limited', 'slow down', { cause, retryAfterMs: 42 });

    assert.strictEqual(normalizeError(failure), failure);
    assert.strictEqual(normalizeError(failure).cause, cause);
  }
);

test.unit.stable(
  'normalization classifies unknown causes without exposing their messages',
  ({ assert: assertions }) => {
    const assert: test.Assert = assertions;

    const cause = Object.assign(new Error('private path'), { code: 'EACCES' });
    const failure = normalizeError(cause);

    assert.ok(failure.kind === 'config');
    assert.ok(failure.message === 'Required resource is not accessible');
    assert.strictEqual(failure.cause, cause);
    assert.ok(failure.retryAfterMs === null);
  }
);
