import { test } from '@study/testing';
test.stable(
  'frontend registration retains the classification in runner output',
  ({ task, expect }) => {
    expect(task.name).toBe(
      '[stable] frontend registration retains the classification in runner output'
    );
  }
);

test.stable.for([
  [1, 'one'],
  [2, 'two']
] as const)('keeps tuple inference for %s', ([number, label], { expect }) => {
  const typedNumber: 1 | 2 = number;
  const typedLabel: 'one' | 'two' = label;

  expect(typedNumber).toBeGreaterThan(0);
  expect(typedLabel.length).toBe(3);
});

test.stable.for([{ name: 'case', value: 42 }])(
  'keeps object case inference',
  (item, { task, expect }) => {
    expect(item.value).toBe(42);
    expect(task.name).toBe('[stable] keeps object case inference');
  }
);
