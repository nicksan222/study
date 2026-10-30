import type { archiveInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof archiveInputSchema.Type;

import { makeArchiveMaterial } from '#server/features/materials/store/archive-material';

export function makeArchiveAction(resources: StoreResources) {
  const { setArchived } = makeArchiveMaterial(resources);
  const archive = (input: Input) => setArchived(input.id, true);

  return {
    archive
  };
}
