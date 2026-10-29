import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DrizzleQueryError } from 'drizzle-orm';

import { classifyError } from '#server/shared/errors/index';

test('Node SQLite numeric busy and locked codes are retryable', () => {
  for (const errcode of [5, 6, 261, 517, 262])
    assert.equal(
      classifyError({ code: 'ERR_SQLITE_ERROR', errcode, message: 'busy' }).kind,
      'transient'
    );

  assert.equal(classifyError({ code: 'ERR_SQLITE_ERROR', errcode: 787 }).kind, 'not_found');
  assert.equal(classifyError({ code: 'ERR_SQLITE_ERROR', errcode: 1 }).kind, 'internal');
});

test('Drizzle preserves native SQLite error classification through its query error', () => {
  for (const [errcode, kind] of [
    [787, 'not_found'],
    [275, 'invalid_input'],
    [2067, 'invalid_input'],
    [1555, 'invalid_input'],
    [5, 'transient'],
    [6, 'transient'],
    [1, 'internal']
  ] as const) {
    const native = Object.assign(new Error('database failure'), {
      code: 'ERR_SQLITE_ERROR',
      errcode
    });
    const error = new DrizzleQueryError('SELECT 1', [], native);

    assert.equal(classifyError(error).kind, kind);
    assert.equal(classifyError(error).message, native.message);
  }
});
