// These public API checks are compiled, never executed.
import {
  subtests,
  testStable,
  testRegression,
  testMigration,
  testCharacterization
} from '@study/testing/node';

import type { Migration, Regression, Characterization } from '../src/classification.ts';

function publicContract() {
  testStable('context inference', async (context) => {
    const name: string = context.name;

    await subtests(context).testStable(name, (child) => {
      void child.signal;
    });
  });
  testStable('options', { timeout: 1000, concurrency: true }, () => {});
  testRegression({ regression: 'evidence_integrity' })('regression', () => {});
  testMigration({ migration: 'source_upgrade', retention: 'permanent' })('migration', () => {});
  testCharacterization({
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
  testStable('missing callback');
  // @ts-expect-error invalid runner option type
  testStable('invalid timeout', { timeout: 'slow' }, () => {});
  void [
    unknownRegression,
    unknownMigration,
    missingRemoval,
    permanentRemoval,
    permanentCharacterization
  ];
}

void publicContract;
