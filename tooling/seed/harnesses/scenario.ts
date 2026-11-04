import type { Db } from '@study/db';

import type { SeedSummary } from '../types.ts';
import type { ProjectDefinition, SeedHarness } from './scope.ts';

/** Project modules are ordinary sequences of creator calls in one synchronous transaction. */
export function seedScenario(db: Db, definitions: readonly ProjectDefinition[]): SeedSummary {
  const summary = { projects: 0, sessions: 0, sources: 0, documents: 0, materials: 0 };
  const harness: SeedHarness = { db, now: BigInt(Math.floor(Date.now() / 1000)), summary };

  db.transaction(() => {
    for (const create of definitions) create(harness);
  });

  return summary;
}
