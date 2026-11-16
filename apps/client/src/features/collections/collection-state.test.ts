import { test } from '@study/testing';

import { validCollectionName } from './collection-state';

test.stable('bounds collection names by Unicode code points', () => {
  test.expect(validCollectionName('😀'.repeat(100))).toBe(true);
  test.expect(validCollectionName('😀'.repeat(101))).toBe(false);
  test.expect(validCollectionName('   ')).toBe(false);
  test.expect(validCollectionName('  Biology  ')).toBe(true);
});
