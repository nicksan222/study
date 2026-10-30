import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { Schema } from 'effect';

import { projectIdSchema } from '../src/ids.ts';

test('project IDs are positive signed 64-bit integers', () => {
  const decode = Schema.decodeUnknownSync(projectIdSchema);

  assert.equal(decode(1n), 1n);
  assert.equal(decode(9223372036854775807n), 9223372036854775807n);
  assert.throws(() => decode(0n));
  assert.throws(() => decode(9223372036854775808n));
  assert.throws(() => decode(1));
});
