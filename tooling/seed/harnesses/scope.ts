import type { ProjectId } from '@study/contracts/ids';
import type { DbTransaction } from '@study/db';

import type { SeedSummary } from '../types.ts';

export type SeedHarness = {
  readonly db: DbTransaction;
  readonly now: bigint;
  readonly summary: SeedSummary;
};

export type ProjectHarness = SeedHarness & { readonly projectId: ProjectId; readonly time: bigint };

export type Created<Id> = { readonly id: Id; readonly projectId: ProjectId };

export type ProjectDefinition = (seed: SeedHarness) => void;

/** Fixture handles carry ownership so notes cannot accidentally mix projects. */
export function ownedId<Id>(project: ProjectHarness, fixture: Created<Id>): Id {
  if (project.projectId !== fixture.projectId)
    throw new RangeError('Seed fixture belongs to another project');

  return fixture.id;
}
