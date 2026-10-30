import type { attachInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof attachInputSchema.Type;

import { makeSessionMembership } from '#server/features/materials/store/session-membership';

export function makeAttachAction(resources: StoreResources) {
  const { attachMaterialTransaction } = makeSessionMembership(resources);
  const attach = (input: Input) => {
    attachMaterialTransaction(input.sessionId, input.materialId);

    return input;
  };

  return {
    attach
  };
}
