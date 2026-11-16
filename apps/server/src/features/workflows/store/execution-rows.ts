/** @file Owns execution rows within this feature. */

import type { executionSchema } from '@study/contracts';
import {
  configurationWaitReasonSchema,
  executionIdSchema,
  failureSchema,
  sourceProcessingRequestedSchema
} from '@study/contracts';
import {
  eq,
  getTableColumns,
  sql,
  workflow_configuration_waits,
  workflow_executions
} from '@study/db';
import type { StoreResources } from '@study/server';
import { Cause, Exit, Schema } from 'effect';
import { Workflow } from 'effect/workflow';

const resultCodec = Schema.fromJsonString(
  Schema.toCodecJson(Workflow.Result({ success: Schema.Unknown, error: Schema.Unknown }))
);

const metadataCodec = Schema.fromJsonString(
  Schema.Struct({
    event: Schema.Struct({ correlationId: sourceProcessingRequestedSchema.fields.correlationId })
  })
);

function exitFailureKind(
  exit: Exit.Exit<unknown, unknown>
): typeof executionSchema.Type.failureKind {
  if (Exit.isSuccess(exit)) return null;

  const failure = Cause.squash(exit.cause);

  return Schema.is(failureSchema)(failure) ? failure.kind : 'internal';
}

function executionOutcome(
  status: typeof workflow_executions.$inferSelect.status,
  result: typeof resultCodec.Type | null
): Pick<typeof executionSchema.Type, 'outcome' | 'failureKind'> {
  if (status === 'blocked' || status === 'cancelled')
    return { outcome: 'failure', failureKind: status === 'blocked' ? 'unsupported' : 'cancelled' };

  if (result?._tag === 'Complete')
    return {
      outcome: Exit.isSuccess(result.exit) ? 'success' : 'failure',
      failureKind: exitFailureKind(result.exit)
    };

  if (result?._tag === 'Suspended' && result.failed)
    return { outcome: 'failure', failureKind: 'internal' };

  return { outcome: null, failureKind: null };
}

export const columns = {
  ...getTableColumns(workflow_executions),
  // Single-table selections strip Column qualifiers; table/name chunks preserve correlation.
  waitReason: sql<
    string | null
  >`(SELECT reason FROM ${workflow_configuration_waits} WHERE execution_id = ${workflow_executions}.${sql.identifier(workflow_executions.execution_id.name)} AND reason IS NOT NULL ORDER BY deferred_name LIMIT 1)`
};

function configurationReason(
  value: string | null,
  status: typeof executionSchema.Type.status,
  outcome: typeof executionSchema.Type.outcome
) {
  return status === 'suspended' &&
    outcome === null &&
    Schema.is(configurationWaitReasonSchema)(value)
    ? value
    : null;
}

export function view(
  row: typeof workflow_executions.$inferSelect & { waitReason: string | null }
): typeof executionSchema.Type {
  const result = row.result !== null ? Schema.decodeUnknownSync(resultCodec)(row.result) : null;
  const { outcome, failureKind } = executionOutcome(row.status, result);
  const status = row.status;

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
    status,
    outcome,
    failureKind,
    configurationWaitReason: configurationReason(row.waitReason, status, outcome),
    canCancel: ['running', 'suspended'].includes(status),
    createdAtMs: row.created_at,
    updatedAtMs: row.updated_at
  };
}

export function makeHelpers({ db }: StoreResources) {
  function find(id: typeof executionIdSchema.Type) {
    const row = db.orm
      .select(columns)
      .from(workflow_executions)
      .where(eq(workflow_executions.execution_id, id))
      .get();

    return row ? view(row) : undefined;
  }

  return { find };
}
