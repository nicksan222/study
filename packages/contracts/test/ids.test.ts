import { test } from '@study/testing';
import { Schema } from 'effect';

import { projectIdSchema } from '../src/ids.ts';

test.stable('project IDs are positive signed 64-bit integers', () => {
  const decode = Schema.decodeUnknownSync(projectIdSchema);

  test.assert.strictEqual(decode(1n), 1n);
  test.assert.strictEqual(decode(9223372036854775807n), 9223372036854775807n);
  test.assert.throws(() => decode(0n));
  test.assert.throws(() => decode(9223372036854775808n));
  test.assert.throws(() => decode(1));
});
