import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StudyError } from '@study/contracts/errors';

import { retryDisposition } from '#server/platform/workflows/retry';

test('classifies workflow failures without retrying terminal errors', () => {
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
