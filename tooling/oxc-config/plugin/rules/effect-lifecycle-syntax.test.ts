import assert from 'node:assert/strict';

import { testStable } from '@study/testing/node';

import { positive } from './effect-lifecycle-syntax.ts';

testStable('lifecycle counts must be safe integers so counters can make progress', () => {
  const literal = (value: number) => ({ type: 'Literal', value });

  assert.equal(positive(literal(Number.MAX_SAFE_INTEGER)), true);
  assert.equal(positive(literal(4)), true);
  assert.equal(positive(literal(0)), false);
  assert.equal(positive(literal(0), true), true);

  for (const value of [Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, -1, 0.5])
    assert.equal(positive(literal(value), true), false, String(value));
});
