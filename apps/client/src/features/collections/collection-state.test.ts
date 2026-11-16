import { test } from '@study/testing';

import { validCollectionName } from './collection-state';

test.stable('bounds collection names by Unicode code points', ({ expect }) => {
  expect(validCollectionName('😀'.repeat(100))).toBe(true);
  expect(validCollectionName('😀'.repeat(101))).toBe(false);
  expect(validCollectionName('   ')).toBe(false);
  expect(validCollectionName('  Biology  ')).toBe(true);
});
