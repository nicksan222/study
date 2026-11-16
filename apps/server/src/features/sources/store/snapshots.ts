/** @file Builds sources snapshots queries and mutations with bound store resources. */

import * as tables from '@study/db';
import { and, eq } from '@study/db';
import { storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';

import { snapshotKey, snapshotSchema } from './schemas.ts';

export function makeSourceSnapshotStore({ db }: StoreResources) {
  return {
    queries: {
      sourceSnapshot: storeQuery({
        role: 'required',
        input: snapshotKey,
        output: snapshotSchema,
        run: (input) => {
          const row = db.orm
            .select()
            .from(tables.source_snapshots)
            .where(
              and(
                eq(tables.source_snapshots.source_id, input.id),
                eq(tables.source_snapshots.revision, BigInt(input.revision))
              )
            )
            .get();

          return row
            ? {
                revision: Number(row.revision),
                bytes: new Uint8Array(row.bytes),
                kind: row.kind,
                mime: row.mime,
                uri: row.uri
              }
            : null;
        }
      })
    },
    mutations: {}
  };
}
