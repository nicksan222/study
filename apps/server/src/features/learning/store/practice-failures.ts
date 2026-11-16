/** @file Owns practice failures within this feature. */

import type { ErrorKind } from '@study/contracts';
import { errorKindSchema } from '@study/contracts';
import * as s from '@study/db';
import { and, desc, eq, sql } from '@study/db';
import type { StoreResources } from '@study/server';
import { Cause, Exit, Option, Schema } from 'effect';

import type { Slot } from './practice-schemas.ts';
import { generationEventId, resultCodec } from './practice-schemas.ts';

export function makePracticeFailures(resources: StoreResources) {
  const { db } = resources;

  function receiptExecutions() {
    return db.orm
      .select({ status: s.workflow_executions.status, result: s.workflow_executions.result })
      .from(s.workflowReceipts)
      .innerJoin(
        s.workflow_executions,
        eq(s.workflow_executions.execution_id, s.workflowReceipts.executionId)
      );
  }

  function failureKind(row: Slot): ErrorKind | null {
    if (row.status !== 'pending') return null;

    if (row.failure_kind) return row.failure_kind;

    const execution = receiptExecutions()
      .where(
        and(
          eq(s.workflowReceipts.eventId, generationEventId(row)),
          eq(s.workflowReceipts.subscription, 'material-generation')
        )
      )
      .get();

    if (!execution) {
      // A committed child event is still durable work even before dispatcher delivery.

      const queued = db.orm
        .select({ id: s.workflowEvents.eventId })
        .from(s.workflowEvents)
        .where(eq(s.workflowEvents.eventId, generationEventId(row)))
        .get();

      if (queued) return null;

      const preparation = receiptExecutions()
        .innerJoin(s.workflowEvents, eq(s.workflowEvents.eventId, s.workflowReceipts.eventId))
        .where(
          and(
            eq(s.workflowReceipts.subscription, 'practice-slot'),
            eq(s.workflowEvents.correlationId, row.id),
            sql`COALESCE(json_extract(${s.workflowEvents.payload}, '$.generationAttempt'), 0) = ${row.generation_attempt}`
          )
        )
        .orderBy(desc(s.workflowEvents.createdAt), desc(s.workflowEvents.eventId))
        .limit(1)
        .get();

      return terminalFailure(preparation);
    }

    return terminalFailure(execution);
  }

  function terminalFailure(
    execution: { status: string; result: string | null } | undefined
  ): ErrorKind | null {
    if (!execution) return null;

    if (execution.status === 'cancelled') return 'cancelled';

    if (execution.status !== 'completed' || !execution.result) return null;

    const result = Schema.decodeUnknownSync(resultCodec)(JSON.parse(execution.result));

    if (result._tag !== 'Complete' || !Exit.isFailure(result.exit)) return null;

    const failure = Cause.findErrorOption(result.exit.cause);

    return Option.isSome(failure) && Schema.is(errorKindSchema)(failure.value.kind)
      ? failure.value.kind
      : 'internal';
  }

  return { failureKind };
}
