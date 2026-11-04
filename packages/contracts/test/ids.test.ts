import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert } from 'vite-plus/test';

import { projectIdSchema } from '../src/ids.ts';

testStable('project IDs are positive signed 64-bit integers', () => {
  const decode = Schema.decodeUnknownSync(projectIdSchema);

  assert.strictEqual(decode(1n), 1n);
  assert.strictEqual(decode(9223372036854775807n), 9223372036854775807n);
  assert.throws(() => decode(0n));
  assert.throws(() => decode(9223372036854775808n));
  assert.throws(() => decode(1));
});
