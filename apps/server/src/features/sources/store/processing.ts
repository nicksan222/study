/** @file Builds sources processing queries and mutations with bound store resources. */

import {
  StudyError,
  sourceIdSchema,
  sourceProcessingJobSchema,
  sourceProcessingSchema
} from '@study/contracts';
import * as tables from '@study/db';
import { and, eq, inArray } from '@study/db';
import { storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Option, Schema } from 'effect';

import { makeHelpers } from './rows.ts';

export function makeSourceProcessingStore({ db, clock, timestampClock }: StoreResources) {
  const { processingRow, state } = makeHelpers({ db, clock, timestampClock });

  return {
    queries: {
      sourceProcessing: storeQuery({
        role: 'required',
        input: sourceIdSchema,
        output: sourceProcessingSchema,
        run: (id) => state(id)!
      }),
      sourceProcessingJob: storeQuery({
        role: 'required',
        input: sourceIdSchema,
        output: sourceProcessingJobSchema,
        run: (id) => {
          const row = processingRow(id);

          if (!row) throw new StudyError('not_found', 'Source processing is unavailable');

          const events = tables.workflowEvents;
          const request = db.orm
            .select({ time: events.createdAt })
            .from(events)
            .where(
              and(
                eq(events.correlationId, row.request_id),
                eq(events.inputVersion, Number(row.revision)),
                inArray(events.type, ['SourceProcessingRequested', 'SourceCorrectionRequested'])
              )
            )
            .get();

          return {
            sourceId: id,
            revision: Number(row.revision),
            requestId: row.request_id,
            documentId: row.document_id,
            publishedRequestId: row.published_request_id,
            requestedAtMs: request ? Number(request.time) : null
          };
        }
      }),
      findSourceProcessing: storeQuery({
        role: 'optional',
        input: sourceIdSchema,
        output: Schema.Option(sourceProcessingSchema),
        run: (id) => Option.fromNullishOr(state(id))
      })
    },
    mutations: {}
  };
}

export function makeSourceFailureNoticeStore({ db }: StoreResources) {
  return {
    queries: {
      sourceFailureNotice: storeQuery({
        role: 'required',
        input: Schema.String,
        output: Schema.Boolean,
        run: (id) =>
          Boolean(
            db.orm
              .select()
              .from(tables.workflowEvents)
              .where(eq(tables.workflowEvents.eventId, id))
              .get()
          )
      })
    },
    mutations: {}
  };
}
