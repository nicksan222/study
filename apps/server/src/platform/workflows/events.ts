import { workflowEventSchema } from '@study/contracts/events';
import type { WorkflowEvent } from '@study/contracts/events';
import { workflowEvents } from '@study/db/schema';
import { Schema } from 'effect';

import type { ServerContext } from '#server/platform/database/context';

const eventCodec = Schema.fromJsonString(Schema.toCodecJson(workflowEventSchema));

export const encodeEvent = (event: WorkflowEvent): string => Schema.encodeSync(eventCodec)(event);

export const decodeEvent = (payload: string): WorkflowEvent =>
  Schema.decodeUnknownSync(eventCodec)(payload);

/** The outbox and the state that caused the event share the active transaction. */
export function emitEvent(context: ServerContext, event: WorkflowEvent, createdAt: number): void {
  context.assertTransactionActive();
  const validated = Schema.decodeUnknownSync(workflowEventSchema)(event);

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
