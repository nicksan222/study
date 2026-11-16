import { test } from '@study/testing';
import { Schema } from 'effect';

import { materialSearchInputSchema } from '../src/system/rpc.ts';

test.stable('Material search trims queries and bounds work before dispatch', () => {
  const decode = Schema.decodeUnknownSync(materialSearchInputSchema);

  test.expect(decode({ query: '  Evidence  ' })).toStrictEqual({ query: 'Evidence', limit: 30 });
  test.expect(decode({ query: 'x'.repeat(1000), limit: 100, project: null })).toStrictEqual({
    query: 'x'.repeat(1000),
    limit: 100,
    project: null
  });
  test.assert.strictEqual(decode({ query: 'x', limit: 1 }).limit, 1);

  for (const query of ['', '   ', 'x'.repeat(1001)]) {
    test.assert.throws(() => decode({ query }));
  }

  for (const limit of [0, -1, 101, 1.5, Infinity]) {
    test.assert.throws(() => decode({ query: 'Evidence', limit }));
  }

  test.assert.throws(() => decode({ query: 'Evidence', project: 0n }));
});
