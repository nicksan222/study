import type { publishVersionInputSchema } from '@study/contracts/materials/rpc';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof publishVersionInputSchema.Type;

import { makeReads, required } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { makeWrites } from '#server/features/materials/store/writes';

export function makePublishVersionAction(resources: StoreResources) {
  const { readVersion } = makeReads(resources);
  const { publish } = makeWrites(resources);
  const publishVersion = (input: Input) =>
    materialIntegrity(() => {
      publish(input.id);

      return required(readVersion(input.id));
    });

  return { publishVersion };
}
