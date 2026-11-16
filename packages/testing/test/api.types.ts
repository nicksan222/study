import type { TestEnvironment, test as publicTest } from '@study/testing';
// These public API checks are compiled, never executed.
import { test } from '@study/testing/vitest';

import type { Migration, Regression, Characterization } from '../src/classification.ts';

type PublicUnitContext = publicTest.unit.Context;

// @ts-expect-error flat classifications are unavailable
type FlatClassification = typeof publicTest.stable;

function flatClassificationType(value: FlatClassification): FlatClassification {
  return value;
}

void flatClassificationType;

function publicContract() {
  test.unit.stable('context inference', async ({ task, mock }) => {
    const name: string = task.name;
    const scopedMock: test.Mock = mock;

    mock('@study/ui', async (load) => ({ ...(await load()), fixtureValue: true }));
    void [name, scopedMock];
  });
  const context: PublicUnitContext = {} as PublicUnitContext;

  void context;
  test.unit.stable('options', { timeout: 1000, concurrent: true }, () => {});
  test.unit.regression({ regression: 'evidence_integrity' })('regression', () => {});
  test.unit.migration({ migration: 'source_upgrade', retention: 'permanent' })(
    'migration',
    () => {}
  );
  test.unit.characterization({
    migration: 'source_upgrade',
    retention: 'temporary',
    removeWhen: 'The old source format is unsupported'
  })('characterization', () => {});
  // @ts-expect-error unknown regression identifier
  const unknownRegression: Regression = { regression: 'untracked-bug' };
  // @ts-expect-error unknown migration identifier
  const unknownMigration: Migration = { migration: 'untracked-change', retention: 'permanent' };
  // @ts-expect-error temporary coverage requires a removal condition
  const missingRemoval: Migration = { migration: 'source_upgrade', retention: 'temporary' };
  // @ts-expect-error permanent coverage rejects a removal condition
  const permanentRemoval: Migration = {
    migration: 'source_upgrade',
    retention: 'permanent',
    removeWhen: 'Never'
  };
  const permanentCharacterization: Characterization = {
    migration: 'source_upgrade',
    // @ts-expect-error characterization must be temporary
    retention: 'permanent'
  };

  // @ts-expect-error callbacks are required
  test.unit.stable('missing callback');
  // @ts-expect-error invalid runner option type
  test.unit.stable('invalid timeout', { timeout: 'slow' }, () => {});
  void [
    unknownRegression,
    unknownMigration,
    missingRemoval,
    permanentRemoval,
    permanentCharacterization
  ];
}

void publicContract;

function environmentContract(environment: TestEnvironment) {
  void environment;
}

void environmentContract;
