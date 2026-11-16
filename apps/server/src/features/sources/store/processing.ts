/** @file Builds sources processing queries and mutations with bound store resources. */

import { sourceIdSchema, sourceProcessingSchema } from '@study/contracts';
import * as tables from '@study/db';
import { eq } from '@study/db';
import { Option, Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { storeQuery } from '#server/platform/definitions/define-store';

import { makeHelpers } from './rows.ts';

export function makeSourceProcessingStore({ db, clock, timestampClock }: StoreResources) {
  const { state } = makeHelpers({ db, clock, timestampClock });

  return {
    queries: {
      sourceProcessing: storeQuery({
        role: 'required',
        input: sourceIdSchema,
        output: sourceProcessingSchema,
        run: (id) => state(id)!
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
