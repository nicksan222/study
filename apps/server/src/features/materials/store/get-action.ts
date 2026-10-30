import type { materialInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof materialInputSchema.Type;

import { makeReads } from '#server/features/materials/store/reads';

export function makeGetAction(resources: StoreResources) {
  const { readMaterial } = makeReads(resources);
  const get = (input: Input) => readMaterial(input.id);

  return { get };
}
