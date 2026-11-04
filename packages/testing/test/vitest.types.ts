// Frontend registration contracts are compiled, never executed.
import {
  testStable,
  testRegression,
  testMigration,
  testCharacterization
} from '@study/testing/vitest';

function frontendContract() {
  testStable.each([[1, 'one']] as const)('tuple inference', (number, label) => {
    const typedNumber: 1 = number;
    const typedLabel: 'one' = label;

    void [typedNumber, typedLabel];
  });
  testStable.for([{ value: 42 }])('object inference', (item, context) => {
    void [item.value, context.task];
  });
  testRegression({ regression: 'evidence_integrity' })('regression fixture', () => {});
  testMigration({ migration: 'source_upgrade', retention: 'permanent' })(
    'migration fixture',
    () => {}
  );
  testCharacterization({
    migration: 'source_upgrade',
    retention: 'temporary',
    removeWhen: 'The old format is unsupported'
  })('characterization fixture', () => {});
}

void frontendContract;
