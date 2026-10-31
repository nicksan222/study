import { createHash } from 'node:crypto';

import { workflowEventSchema } from '@study/contracts/events';
import type { WorkflowEvent } from '@study/contracts/events';
import { and, eq, lt, sql } from '@study/db';
import { workflowEvents, workflowReceipts, workflow_executions } from '@study/db/schema';
import { Schema } from 'effect';
import type { Workflow } from 'effect/workflow';

import type { ServerContext } from '#server/platform/database/context';
import { decodeEvent } from '#server/platform/workflows/events';

export type EventType = WorkflowEvent['type'];

export type Trigger = {
  readonly subscription: string;
  readonly event: EventType;
  readonly workflowVersion: number;
  readonly workflow: Workflow.Any;
  readonly emits: readonly EventType[];
  readonly enabled: () => boolean;
};

const workflowPayloadSchema = Schema.Struct({ event: workflowEventSchema });

const payloadCodec = Schema.toCodecJson(workflowPayloadSchema);

export function validateTriggerGraph(
  edges: readonly { event: EventType; emits: readonly EventType[] }[],
  maxFanout = 16,
  maxDepth = 8
): void {
  const visit = (type: EventType, path: readonly EventType[]): number => {
    if (path.includes(type))
      throw new Error(`automatic workflow cycle: ${[...path, type].join(' -> ')}`);

    if (path.length >= maxDepth) throw new Error('automatic workflow depth exceeded');

    const children = edges.filter((edge) => edge.event === type).flatMap((edge) => edge.emits);
    const count = children.reduce((n, child) => n + 1 + visit(child, [...path, type]), 0);

    if (count > maxFanout) throw new Error('automatic workflow fanout exceeded');

    return count;
  };

  for (const edge of edges) visit(edge.event, []);
}

/** Persist execution and receipt atomically; recovery starts executions after commit. */
export function dispatchPending(
  context: ServerContext,
  triggers: readonly Trigger[],
  now: number,
  batchSize = 100
): number {
  validateTriggerGraph(triggers);

  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new TypeError('invalid workflow batch size');

  const identities = new Set<string>();

  for (const trigger of triggers) {
    if (
      !/^[a-z][a-z0-9/-]*$/.test(trigger.subscription) ||
      !trigger.workflow._tag ||
      !Number.isSafeInteger(trigger.workflowVersion) ||
      trigger.workflowVersion < 1 ||
      identities.has(trigger.subscription)
    )
      throw new Error('invalid or duplicate subscription');

    identities.add(trigger.subscription);
  }

  const db = context.db.orm;

  return context.transaction(() => {
    let scheduled = 0;

    for (const trigger of triggers) {
      const enabled: unknown = trigger.enabled();

      if (typeof enabled !== 'boolean')
        throw new TypeError('workflow policy must return a boolean synchronously');

      if (!enabled) continue;

      const rows = db
        .select()
        .from(workflowEvents)
        .where(
          and(
            eq(workflowEvents.type, trigger.event),
            lt(workflowEvents.depth, 8),
            sql`NOT EXISTS (SELECT 1 FROM ${workflowReceipts} WHERE ${workflowReceipts.eventId} = ${workflowEvents.eventId} AND ${workflowReceipts.subscription} = ${trigger.subscription} AND ${workflowReceipts.workflowVersion} = ${trigger.workflowVersion} AND ${workflowReceipts.inputVersion} = ${workflowEvents.inputVersion})`
          )
        )
        .orderBy(workflowEvents.createdAt, workflowEvents.eventId)
        .limit(batchSize)
        .all();

      for (const row of rows) {
        const event = decodeEvent(row.payload);
        const executionId = createHash('sha256')
          .update(
            JSON.stringify([
              event.eventId,
              trigger.subscription,
              trigger.workflowVersion,
              event.inputVersion
            ])
          )
          .digest('hex');
        const payload = JSON.stringify(Schema.encodeSync(payloadCodec)({ event }));

        db.insert(workflow_executions)
          .values({
            execution_id: executionId,
            workflow_tag: trigger.workflow._tag,
            version: trigger.workflowVersion,
            payload,
            status: 'running',
            owner_token: null,
            created_at: BigInt(now),
            updated_at: BigInt(now)
          })
          .run();
        db.insert(workflowReceipts)
          .values({
            eventId: event.eventId,
            subscription: trigger.subscription,
            workflowVersion: trigger.workflowVersion,
            inputVersion: event.inputVersion,
            executionId,
            createdAt: now
          })
          .run();
        scheduled++;
      }
    }

    return scheduled;
  });
}
