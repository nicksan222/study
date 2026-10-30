import type { unarchiveInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof unarchiveInputSchema.Type;

import { makeArchiveMaterial } from '#server/features/materials/store/archive-material';

export function makeUnarchiveAction(resources: StoreResources) {
  const { setArchived } = makeArchiveMaterial(resources);
  const unarchive = (input: Input) => setArchived(input.id, false);

  return { unarchive };
}
