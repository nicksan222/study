import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

import { validCollectionName } from './collection-state';

testStable('bounds collection names by Unicode code points', () => {
  expect(validCollectionName('😀'.repeat(100))).toBe(true);
  expect(validCollectionName('😀'.repeat(101))).toBe(false);
  expect(validCollectionName('   ')).toBe(false);
  expect(validCollectionName('  Biology  ')).toBe(true);
});
