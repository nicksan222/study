/** @file Builds sources documents queries and mutations with bound store resources. */

import {
  contentSnapshotIdSchema,
  documentSchema,
  projectIdSchema,
  sourceIdSchema
} from '@study/contracts';
import * as tables from '@study/db';
import { and, eq, isNull } from '@study/db';
import { storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { makeHelpers } from './rows.ts';

export function makeSourceDocumentStore({ db, clock, timestampClock }: StoreResources) {
  const { readDocument, find } = makeHelpers({ db, clock, timestampClock });

  return {
    queries: {
      sourceDocument: storeQuery({
        role: 'required',
        input: sourceIdSchema,
        output: Schema.Struct({ id: contentSnapshotIdSchema, document: documentSchema }),
        run: (sourceId) => {
          find(sourceId);
          const row = db.orm
            .select({ id: tables.content_snapshots.id, meta: tables.content_snapshots.meta })
            .from(tables.source_processing)
            .innerJoin(
              tables.content_snapshots,
              eq(tables.content_snapshots.id, tables.source_processing.document_id)
            )
            .where(eq(tables.source_processing.source_id, sourceId))
            .get();

          if (!row) return null;

          return readDocument(row);
        }
      })
    },
    mutations: {}
  };
}

export function makeHistoricalDocumentStore({ db, clock, timestampClock }: StoreResources) {
  const { readDocument, find } = makeHelpers({ db, clock, timestampClock });

  return {
    queries: {
      document: storeQuery({
        role: 'required',
        input: Schema.Struct({
          id: contentSnapshotIdSchema,
          sourceId: sourceIdSchema,
          projectId: Schema.NullOr(projectIdSchema)
        }),
        output: Schema.Struct({ id: contentSnapshotIdSchema, document: documentSchema }),
        run: (input) => {
          find(input.sourceId);
          const row = db.orm
            .select({ id: tables.content_snapshots.id, meta: tables.content_snapshots.meta })
            .from(tables.content_snapshots)
            .innerJoin(tables.sources, eq(tables.sources.id, tables.content_snapshots.source_id))
            .where(
              and(
                eq(tables.content_snapshots.id, input.id),
                eq(tables.sources.id, input.sourceId),
                input.projectId === null
                  ? isNull(tables.sources.project_id)
                  : eq(tables.sources.project_id, input.projectId)
              )
            )
            .get();

          return row ? readDocument(row) : null;
        }
      })
    },
    mutations: {}
  };
}
