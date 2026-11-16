import { test } from '@study/testing';
test.stable('frontend registration retains the classification in runner output', ({ task }) => {
  test
    .expect(task.name)
    .toBe('[stable] frontend registration retains the classification in runner output');
});

test.stable.each([
  [1, 'one'],
  [2, 'two']
] as const)('keeps tuple inference for %s', (number, label) => {
  const typedNumber: 1 | 2 = number;
  const typedLabel: 'one' | 'two' = label;

  test.expect(typedNumber).toBeGreaterThan(0);
  test.expect(typedLabel.length).toBe(3);
});

test.stable.for([{ name: 'case', value: 42 }])('keeps object case inference', (item, { task }) => {
  test.expect(item.value).toBe(42);
  test.expect(task.name).toBe('[stable] keeps object case inference');
});
