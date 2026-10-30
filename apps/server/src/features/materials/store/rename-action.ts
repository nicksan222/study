import type { renameInputSchema } from '@study/contracts/materials/rpc';
import { eq } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Input = typeof renameInputSchema.Type;

import { makeReads, required } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { now } from '#server/features/materials/store/writes';

export function makeRenameAction(resources: StoreResources) {
  const { db: store, clock } = resources;
  const { materialRow, readMaterial } = makeReads(resources);
  const rename = (input: Input) =>
    materialIntegrity(() => {
      materialRow(input.id, true);
      store.orm
        .update(s.materials)
        .set({ title: input.title, updated_at: now(clock) })
        .where(eq(s.materials.id, input.id))
        .run();

      return required(readMaterial(input.id));
    });

  return { rename };
}
