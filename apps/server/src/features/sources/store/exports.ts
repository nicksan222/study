/** @file Builds sources exports queries and mutations with bound store resources. */

import { sourceExportSchema, sourceIdSchema } from '@study/contracts';
import * as tables from '@study/db';
import { eq } from '@study/db';
import { storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';

import { makeHelpers } from './rows.ts';

export function makeSourceExportStore({ db, clock, timestampClock }: StoreResources) {
  const { find } = makeHelpers({ db, clock, timestampClock });

  return {
    queries: {
      sourceExport: storeQuery({
        role: 'required',
        input: sourceIdSchema,
        output: sourceExportSchema,
        run: (id) => {
          const source = find(id);
          const blob = db.orm
            .select()
            .from(tables.source_blobs)
            .where(eq(tables.source_blobs.source_id, id))
            .get();

          return source && blob ? { source, bytes: new Uint8Array(blob.bytes) } : null;
        }
      })
    },
    mutations: {}
  };
}
