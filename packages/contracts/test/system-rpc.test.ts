import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Schema } from 'effect';

import { materialSearchInputSchema } from '../src/system/rpc.ts';

test('Material search trims queries and bounds work before dispatch', () => {
  const decode = Schema.decodeUnknownSync(materialSearchInputSchema);

  assert.deepEqual(decode({ query: '  Evidence  ' }), { query: 'Evidence', limit: 30 });
  assert.deepEqual(decode({ query: 'x'.repeat(1000), limit: 100, project: null }), {
    query: 'x'.repeat(1000),
    limit: 100,
    project: null
  });
  assert.equal(decode({ query: 'x', limit: 1 }).limit, 1);

  for (const query of ['', '   ', 'x'.repeat(1001)]) {
    assert.throws(() => decode({ query }));
  }

  for (const limit of [0, -1, 101, 1.5, Infinity]) {
    assert.throws(() => decode({ query: 'Evidence', limit }));
  }

  assert.throws(() => decode({ query: 'Evidence', project: 0n }));
});
