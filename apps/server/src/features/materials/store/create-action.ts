import type { createInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof createInputSchema.Type;

import { makeCreateMaterial } from '#server/features/materials/store/create-material';

export function makeCreateAction(resources: StoreResources) {
  const { createMaterial } = makeCreateMaterial(resources);
  const create = (input: Input) => createMaterial(input);

  return {
    create
  };
}
