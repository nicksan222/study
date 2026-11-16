/** @file Builds workflows executions queries and mutations with bound store resources. */

import {
  StudyError,
  executionIdSchema,
  executionSchema,
  executionsInputSchema
} from '@study/contracts';
import { and, desc, eq, inArray, lt, or, sql, workflow_executions } from '@study/db';
import { Option, Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { storeQuery } from '#server/platform/definitions/define-store';

import { columns, makeHelpers, view } from './execution-rows.ts';

export function makeExecutionStore({ db, clock, timestampClock }: StoreResources) {
  const { find } = makeHelpers({ db, clock, timestampClock });

  return {
    queries: {
      execution: storeQuery({
        role: 'required',
        input: executionIdSchema,
        output: executionSchema,
        run: (id) => {
          const row = find(id);

          if (!row) throw new StudyError('not_found', 'Workflow execution missing');

          return row;
        }
      }),
      findExecution: storeQuery({
        role: 'optional',
        input: executionIdSchema,
        output: Schema.Option(executionSchema),
        run: (id) => Option.fromNullishOr(find(id))
      }),
      executions: storeQuery({
        role: 'collection',
        input: executionsInputSchema,
        output: Schema.Array(executionSchema),
        run: (input) =>
          db.orm
            .select(columns)
            .from(workflow_executions)
            .where(
              and(
                input.workflows === undefined
                  ? undefined
                  : inArray(workflow_executions.workflow_tag, [...input.workflows]),
                input.correlationId === undefined
                  ? undefined
                  : eq(
                      sql<string>`json_extract(${workflow_executions.payload}, '$.event.correlationId')`,
                      input.correlationId
                    ),
                input.eventId === undefined
                  ? undefined
                  : eq(
                      sql<string>`json_extract(${workflow_executions.payload}, '$.event.eventId')`,
                      input.eventId
                    ),
                input.before === undefined
                  ? undefined
                  : or(
                      lt(workflow_executions.created_at, input.before.createdAtMs),
                      and(
                        eq(workflow_executions.created_at, input.before.createdAtMs),
                        lt(workflow_executions.execution_id, input.before.id)
                      )
                    )
              )
            )
            .orderBy(desc(workflow_executions.created_at), desc(workflow_executions.execution_id))
            .limit(input.limit)
            .all()
            .map(view)
      })
    },
    mutations: {}
  };
}
