import { testStable } from '@study/testing/vitest';
import { Schema } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { materialSearchInputSchema } from '../src/system/rpc.ts';

testStable('Material search trims queries and bounds work before dispatch', () => {
  const decode = Schema.decodeUnknownSync(materialSearchInputSchema);

  expect(decode({ query: '  Evidence  ' })).toStrictEqual({ query: 'Evidence', limit: 30 });
  expect(decode({ query: 'x'.repeat(1000), limit: 100, project: null })).toStrictEqual({
    query: 'x'.repeat(1000),
    limit: 100,
    project: null
  });
  assert.strictEqual(decode({ query: 'x', limit: 1 }).limit, 1);

  for (const query of ['', '   ', 'x'.repeat(1001)]) {
    assert.throws(() => decode({ query }));
  }

  for (const limit of [0, -1, 101, 1.5, Infinity]) {
    assert.throws(() => decode({ query: 'Evidence', limit }));
  }

  assert.throws(() => decode({ query: 'Evidence', project: 0n }));
});
