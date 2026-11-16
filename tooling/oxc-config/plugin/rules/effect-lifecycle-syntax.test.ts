import { test } from '@study/testing';

import { positive } from './effect-lifecycle-syntax.ts';

test.stable('lifecycle counts must be safe integers so counters can make progress', () => {
  const literal = (value: number) => ({ type: 'Literal', value });

  test.assert.strictEqual(positive(literal(Number.MAX_SAFE_INTEGER)), true);
  test.assert.strictEqual(positive(literal(4)), true);
  test.assert.strictEqual(positive(literal(0)), false);
  test.assert.strictEqual(positive(literal(0), true), true);

  for (const value of [Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, -1, 0.5])
    test.assert.strictEqual(positive(literal(value), true), false, String(value));
});
