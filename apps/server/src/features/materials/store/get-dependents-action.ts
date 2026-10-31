import type { dependentsInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { makeLinkedVersions } from './linked-versions.ts';

export function makeGetDependentsAction(resources: StoreResources) {
  const linkedVersions = makeLinkedVersions(resources);

  return {
    getDependents: (input: typeof dependentsInputSchema.Type) => linkedVersions(input, 'dependents')
  };
}
