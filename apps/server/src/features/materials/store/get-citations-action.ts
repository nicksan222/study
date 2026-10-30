import type { citationsInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof citationsInputSchema.Type;

import { makeCitations } from '#server/features/materials/store/citations';

export function makeGetCitationsAction(resources: StoreResources) {
  const { readCitations } = makeCitations(resources);
  const getCitations = (input: Input) => readCitations(input.id);

  return { getCitations };
}
