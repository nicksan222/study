import type { MaterialId } from '@study/contracts/ids';
import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { required, makeReads } from '#server/features/materials/store/reads';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { now } from '#server/features/materials/store/writes';
import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeArchiveMaterial(resources: StoreResources) {
  const { db, clock } = resources;
  const store = db;
  const { materialRow, readMaterial } = makeReads(resources);

  function setArchived(id: MaterialId, archived: boolean) {
    return materialIntegrity(() => {
      materialRow(id);
      const timestamp = now(clock);

      store.orm
        .update(s.materials)
        .set({
          archived_at: archived ? timestamp : null,
          updated_at: timestamp
        })
        .where(eq(s.materials.id, id))
        .run();

      return required(readMaterial(id));
    });
  }

  return {
    setArchived
  };
}
