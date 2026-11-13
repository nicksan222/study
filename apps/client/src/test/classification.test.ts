import { testStable } from '@study/testing/vitest';
import { expect } from 'vite-plus/test';

testStable('frontend registration retains the classification in runner output', ({ task }) => {
  expect(task.name).toBe(
    '[stable] frontend registration retains the classification in runner output'
  );
});

testStable.each([
  [1, 'one'],
  [2, 'two']
] as const)('keeps tuple inference for %s', (number, label) => {
  const typedNumber: 1 | 2 = number;
  const typedLabel: 'one' | 'two' = label;

  expect(typedNumber).toBeGreaterThan(0);
  expect(typedLabel.length).toBe(3);
});

testStable.for([{ name: 'case', value: 42 }])('keeps object case inference', (item, { task }) => {
  expect(item.value).toBe(42);
  expect(task.name).toBe('[stable] keeps object case inference');
});
