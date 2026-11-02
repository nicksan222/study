/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Encodes and decodes canonical workflow events and persists them inside the         │
 * │ caller’s active SQLite transaction. Event rows act as durable work records for later     │
 * │ trigger dispatch.                                                                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports encodeEvent, decodeEvent, emitEvent. Event rows act as durable work records    │
 * │   for later trigger dispatch.                                                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses canonical WorkflowEvent schemas and the caller’s active ServerContext transaction;  │
 * │ the worker later dispatches persisted events.                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { workflowEventSchema } from '@study/contracts/events';
import type { WorkflowEvent } from '@study/contracts/events';
import { and, eq } from '@study/db';
import { workflowEvents, workflow_retired_correlations } from '@study/db/schema';
import { Schema } from 'effect';

import type { ServerContext } from '#server/platform/database/context';

const eventCodec = Schema.fromJsonString(Schema.toCodecJson(workflowEventSchema));

export const encodeEvent: (event: WorkflowEvent) => string = Schema.encodeSync(eventCodec);

export const decodeEvent: (payload: string) => WorkflowEvent = Schema.decodeUnknownSync(eventCodec);

const validateEvent = Schema.decodeUnknownSync(workflowEventSchema);

/** The outbox and the state that caused the event share the active transaction. */
export function emitEvent(context: ServerContext, event: WorkflowEvent, createdAt: number): void {
  context.assertTransactionActive();
  const validated = validateEvent(event);

  if (
    context.db.orm
      .select()
      .from(workflow_retired_correlations)
      .where(
        and(
          eq(workflow_retired_correlations.correlation_id, validated.correlationId),
          eq(workflow_retired_correlations.event_type, validated.type)
        )
      )
      .get()
  )
    throw new StudyError('cancelled', 'Workflow correlation has been retired');

  context.db.orm
    .insert(workflowEvents)
    .values({
      eventId: validated.eventId,
      type: validated.type,
      causationId: validated.causationId,
      correlationId: validated.correlationId,
      inputVersion: validated.inputVersion,
      depth: validated.depth,
      payload: encodeEvent(validated),
      createdAt
    })
    .run();
}
