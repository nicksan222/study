import type { materialVersionInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof materialVersionInputSchema.Type;

import { makeReads } from '#server/features/materials/store/reads';

export function makeGetVersionAction(resources: StoreResources) {
  const { readVersion } = makeReads(resources);
  const getVersion = (input: Input) => readVersion(input.id);

  return { getVersion };
}
