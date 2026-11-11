import type { Db } from '@study/db';

import type { SeedSummary } from '../types.ts';
import type { ProjectDefinition, SeedHarness } from './scope.ts';

/** Project modules are ordinary sequences of creator calls in one synchronous transaction. */
export function seedScenario(db: Db, definitions: readonly ProjectDefinition[]): SeedSummary {
  const summary = { projects: 0, notes: 0, sources: 0, pages: 0, materials: 0 };

  db.transaction((tx) => {
    const harness: SeedHarness = { db: tx, now: BigInt(Math.floor(Date.now() / 1000)), summary };

    for (const create of definitions) create(harness);
  });

  return summary;
}
