import type { inputsInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeLinkedVersions } from './linked-versions.ts';

export function makeGetInputsAction(resources: StoreResources) {
  const linkedVersions = makeLinkedVersions(resources);

  return { getInputs: (input: typeof inputsInputSchema.Type) => linkedVersions(input, 'inputs') };
}
