import { test } from '@study/testing';
import { Schema } from 'effect';

import { projectIdSchema } from '../src/ids.ts';

test.stable('project IDs are positive signed 64-bit integers', ({ assert: assertions }) => {
  const assert: test.Assert = assertions;

  const decode = Schema.decodeUnknownSync(projectIdSchema);

  assert.strictEqual(decode(1n), 1n);
  assert.strictEqual(decode(9223372036854775807n), 9223372036854775807n);
  assert.throws(() => decode(0n));
  assert.throws(() => decode(9223372036854775808n));
  assert.throws(() => decode(1));
});
