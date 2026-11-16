import type { TestEnvironment } from '@study/testing';
// These public API checks are compiled, never executed.
import { test } from '@study/testing/vitest';

import type { Migration, Regression, Characterization } from '../src/classification.ts';

function publicContract() {
  test.stable('context inference', async (context) => {
    const name: string = context.task.name;

    void name;
  });
  test.stable('options', { timeout: 1000, concurrent: true }, () => {});
  test.regression({ regression: 'evidence_integrity' })('regression', () => {});
  test.migration({ migration: 'source_upgrade', retention: 'permanent' })('migration', () => {});
  test.characterization({
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
  test.stable('missing callback');
  // @ts-expect-error invalid runner option type
  test.stable('invalid timeout', { timeout: 'slow' }, () => {});
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
