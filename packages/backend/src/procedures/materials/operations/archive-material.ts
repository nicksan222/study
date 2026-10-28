import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { materialRow, readMaterial, required } from '#backend/procedures/materials/reads';
import { materialTransaction } from '#backend/procedures/materials/transactions';
import { now } from '#backend/procedures/materials/writes';
import type { BackendContext } from '#backend/runtime/context';

export function setArchived(store: BackendContext, id: bigint, archived: boolean) {
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
