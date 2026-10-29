import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { materialRow, readMaterial, required } from '#server/procedures/materials/reads';
import { materialTransaction } from '#server/procedures/materials/transactions';
import { now } from '#server/procedures/materials/writes';
import type { ServerContext } from '#server/runtime/context';

export function setArchived(store: ServerContext, id: bigint, archived: boolean) {
  return materialTransaction(store, () => {
    materialRow(store, id);
    const timestamp = now();

    store.db.orm
      .update(s.materials)
      .set({ archived_at: archived ? timestamp : null, updated_at: timestamp })
      .where(eq(s.materials.id, id))
      .run();

    return required(readMaterial(store, id));
  });
}
