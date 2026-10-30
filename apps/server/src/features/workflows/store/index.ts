import { failureSchema, StudyError } from '@study/contracts/errors';
import { sourceProcessingRequestedSchema } from '@study/contracts/events';
import {
  executionIdSchema,
  executionSchema,
  executionsInputSchema
} from '@study/contracts/workflows/schemas';
import { and, desc, eq, lt, or, sql } from '@study/db';
import { workflow_executions } from '@study/db/schema';
import { Cause, Exit, Option, Schema } from 'effect';
import { Workflow } from 'effect/workflow';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

const resultCodec = Schema.fromJsonString(
  Schema.toCodecJson(Workflow.Result({ success: Schema.Unknown, error: Schema.Unknown }))
);

const metadataCodec = Schema.fromJsonString(
  Schema.Struct({
    event: Schema.Struct({ correlationId: sourceProcessingRequestedSchema.fields.correlationId })
  })
);

function executionOutcome(
  status: typeof workflow_executions.$inferSelect.status,
  result: typeof resultCodec.Type | null
) {
  let outcome: (typeof executionSchema.Type)['outcome'] = null;
  let failureKind: (typeof executionSchema.Type)['failureKind'] = null;

  if (status === 'cancelled') {
    outcome = 'failure';
    failureKind = 'cancelled';
  } else if (result?._tag === 'Complete') {
    outcome = Exit.isSuccess(result.exit) ? 'success' : 'failure';

    if (Exit.isFailure(result.exit)) {
      const failure = Cause.squash(result.exit.cause);

      failureKind = Schema.is(failureSchema)(failure) ? failure.kind : 'internal';
    }
  } else if (result?._tag === 'Suspended' && result.failed) {
    outcome = 'failure';
    failureKind = 'internal';
  }

  return { outcome, failureKind };
}

function view(row: typeof workflow_executions.$inferSelect): typeof executionSchema.Type {
  const pending = row.result === '"__interrupt_safe__"' || row.result === '"__interrupt_unsafe__"';
  const result =
    row.result !== null && !pending ? Schema.decodeUnknownSync(resultCodec)(row.result) : null;
  const { outcome, failureKind } = executionOutcome(row.status, result);

  let correlationId: string | null = null;

  try {
    correlationId = Schema.decodeUnknownSync(metadataCodec)(row.payload).event.correlationId;
  } catch {
    /* Native workflows may have non-event payloads. */
  }

  return {
    id: Schema.decodeUnknownSync(executionIdSchema)(row.execution_id),
    workflow: row.workflow_tag,
    correlationId,
    status: pending ? 'cancelling' : row.status,
    outcome,
    failureKind,
    canCancel: !pending && (row.status === 'running' || row.status === 'suspended'),
    createdAtMs: row.created_at,
    updatedAtMs: row.updated_at
  };
}

function makeHelpers({ db }: StoreResources) {
  function find(id: typeof executionIdSchema.Type) {
    const row = db.orm
      .select()
      .from(workflow_executions)
      .where(eq(workflow_executions.execution_id, id))
      .get();

    return row ? view(row) : undefined;
  }

  return { find };
}

export const ExecutionStore = defineStore({
  name: 'study/ExecutionStore',
  entity: { singular: 'execution', plural: 'executions' },
  make: ({ db, clock }) => {
    const { find } = makeHelpers({ db, clock });

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
              .select()
              .from(workflow_executions)
              .where(
                and(
                  input.correlationId === undefined
                    ? undefined
                    : eq(
                        sql<string>`json_extract(${workflow_executions.payload}, '$.event.correlationId')`,
                        input.correlationId
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
});
