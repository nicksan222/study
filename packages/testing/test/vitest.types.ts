// Frontend registration contracts are compiled, never executed.
import { test } from '@study/testing/vitest';

function frontendContract() {
  test.unit.stable.each([[1, 'one']] as const)('tuple inference', (number, label) => {
    const typedNumber: 1 = number;
    const typedLabel: 'one' = label;

    void [typedNumber, typedLabel];
  });
  test.unit.stable.for([{ value: 42 }])('object inference', (item, { task, mock }) => {
    void [item.value, task, mock];
  });
  test.unit.regression({ regression: 'evidence_integrity' })('regression fixture', () => {});
  test.unit.migration({ migration: 'source_upgrade', retention: 'permanent' })(
    'migration fixture',
    () => {}
  );
  test.unit.characterization({
    migration: 'source_upgrade',
    retention: 'temporary',
    removeWhen: 'The old format is unsupported'
  })('characterization fixture', () => {});
}

void frontendContract;

const withAnswer = test.unit.stable.extend('answer', { scope: 'worker' }, () => 42);

withAnswer('fixture inference', ({ answer }) => {
  const value: number = answer;
  // @ts-expect-error Fixture values retain their inferred type.
  const invalid: string = answer;

  void [value, invalid];
});
