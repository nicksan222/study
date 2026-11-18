/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Validates event-trigger subscription graphs and dispatches pending workflow events │
 * │ transactionally. Each dispatch creates a deterministic execution and receipt so          │
 * │ committed events are retried safely.                                                     │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports EventType, Trigger, validateTriggerGraph, dispatchPending. Each dispatch       │
 * │   creates a deterministic execution and receipt so committed events are retried safely.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature registrations and canonical WorkflowEvent schemas define dispatch inputs;        │
 * │ workers consume rows only after transaction commit.                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { workflowEventSchema } from '@study/contracts';
import type { WorkflowEvent } from '@study/contracts';
import { and, eq, lt, sql } from '@study/db';
import {
  workflowEvents,
  workflowReceipts,
  workflow_executions,
  workflow_retired_executions
} from '@study/db';
import { CryptoHasher } from 'bun';
import { Effect, Option, Schema } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import { Workflow } from 'effect/workflow';

import type { ServerContext } from '#server/platform/database/context';
import { decodeEvent } from '#server/platform/workflows/events';

import { withDispatchPermit } from './admission.ts';
import { reconcileCancellation } from './cancellation.ts';
import { workflowStore } from './store.ts';

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

/** Dispatch and callers awaiting a committed request share one execution. */
export function triggeredExecutionId(
  event: Pick<WorkflowEvent, 'eventId' | 'inputVersion'>,
  trigger: Pick<Trigger, 'subscription' | 'workflowVersion'>
) {
  return new CryptoHasher('sha256')
    .update(
      JSON.stringify([
        event.eventId,
        trigger.subscription,
        trigger.workflowVersion,
        event.inputVersion
      ])
    )
    .digest('hex');
}

export function validateTriggerGraph(
  edges: readonly { event: EventType; emits: readonly EventType[] }[],
  maxFanout = 16,
  maxDepth = 8
): void {
  const childrenByEvent = new Map<EventType, EventType[]>();

  for (const edge of edges) {
    const children = childrenByEvent.get(edge.event) ?? [];

    children.push(...edge.emits);
    childrenByEvent.set(edge.event, children);
  }

  const visit = (type: EventType, path: readonly EventType[]): number => {
    if (path.includes(type))
      throw new Error(`automatic workflow cycle: ${[...path, type].join(' -> ')}`);

    if (path.length >= maxDepth) throw new Error('automatic workflow depth exceeded');

    const children = childrenByEvent.get(type) ?? [];
    const count = children.reduce((n, child) => n + 1 + visit(child, [...path, type]), 0);

    if (count > maxFanout) throw new Error('automatic workflow fanout exceeded');

    return count;
  };

  for (const edge of edges) visit(edge.event, []);
}

function eligibleEvent(trigger: Trigger) {
  return sql`NOT EXISTS (SELECT 1 FROM ${workflow_executions} e WHERE json_extract(e.payload, '$.event.eventId') = ${workflowEvents.eventId} AND e.workflow_tag = ${trigger.workflow._tag} AND (e.cancellation_mode IS NOT NULL OR e.status IN ('cancelled','blocked') OR EXISTS (SELECT 1 FROM workflow_retired_executions r WHERE r.execution_id=e.execution_id))) AND NOT EXISTS (SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id=${workflowEvents.correlationId} AND r.event_type=${workflowEvents.type})`;
}

/** Persist execution and receipt atomically; recovery starts executions after commit. */
export function admitPending(
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

  return context.transaction(['workflows'], (context) => {
    const db = context.db.orm;
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
            eligibleEvent(trigger),
            sql`NOT EXISTS (SELECT 1 FROM workflow_retired_correlations r WHERE r.correlation_id = ${workflowEvents.correlationId} AND r.event_type = ${workflowEvents.type})`,
            lt(workflowEvents.depth, 8),
            sql`NOT EXISTS (SELECT 1 FROM ${workflowReceipts} WHERE ${workflowReceipts.eventId} = ${workflowEvents.eventId} AND ${workflowReceipts.subscription} = ${trigger.subscription} AND ${workflowReceipts.workflowVersion} = ${trigger.workflowVersion} AND ${workflowReceipts.inputVersion} = ${workflowEvents.inputVersion})`
          )
        )
        .orderBy(workflowEvents.createdAt, workflowEvents.eventId)
        .limit(batchSize)
        .all();

      for (const row of rows) {
        const event = decodeEvent(row.payload);
        const executionId = triggeredExecutionId(event, trigger);
        const payload = JSON.stringify(Schema.encodeSync(payloadCodec)({ event }));

        // A caller may have started the committed request before the consumer tick.
        db.insert(workflow_executions)
          .values({
            execution_id: executionId,
            workflow_tag: trigger.workflow._tag,
            version: trigger.workflowVersion,
            payload,
            status: 'running',
            created_at: BigInt(now),
            updated_at: BigInt(now)
          })
          .onConflictDoNothing()
          .run();
        scheduled++;
      }
    }

    return scheduled;
  });
}

/** Bridge committed domain intent to officially persisted messages before acknowledging delivery. */
export function dispatchPending(
  context: ServerContext,
  triggers: readonly Trigger[],
  now: number,
  batchSize = 100
) {
  return withDispatchPermit(
    context,
    Effect.gen(function* () {
      yield* Effect.sync(() => admitPending(context, triggers, now, batchSize));
      const engine = yield* WorkflowEngine.WorkflowEngine;
      let delivered = 0;

      for (const trigger of triggers) {
        const rows = yield* Effect.sync(() =>
          context.db.orm
            .select()
            .from(workflowEvents)
            .where(
              and(
                eq(workflowEvents.type, trigger.event),
                eligibleEvent(trigger),
                lt(workflowEvents.depth, 8),
                sql`NOT EXISTS (SELECT 1 FROM ${workflowReceipts} WHERE ${workflowReceipts.eventId} = ${workflowEvents.eventId} AND ${workflowReceipts.subscription} = ${trigger.subscription} AND ${workflowReceipts.workflowVersion} = ${trigger.workflowVersion})`
              )
            )
            .orderBy(workflowEvents.createdAt, workflowEvents.eventId)
            .limit(batchSize)
            .all()
        );

        for (const row of rows) {
          const event = decodeEvent(row.payload);
          const executionId = triggeredExecutionId(event, trigger);
          const admitted = context.db.orm
            .select()
            .from(workflow_executions)
            .where(eq(workflow_executions.execution_id, executionId))
            .get();

          if (
            !admitted ||
            admitted.status === 'blocked' ||
            admitted.cancellation_mode ||
            admitted.status === 'cancelled' ||
            context.db.orm
              .select()
              .from(workflow_retired_executions)
              .where(eq(workflow_retired_executions.execution_id, executionId))
              .get()
          )
            continue;

          yield* engine.execute(
            trigger.workflow as Workflow.Workflow<
              string,
              typeof workflowPayloadSchema,
              typeof Schema.Unknown,
              typeof Schema.Unknown
            >,
            { executionId, payload: { event }, discard: true }
          );
          yield* Effect.sync(() =>
            context.transaction(['workflows'], (tx) => {
              tx.db.orm
                .insert(workflowReceipts)
                .values({
                  eventId: event.eventId,
                  subscription: trigger.subscription,
                  workflowVersion: trigger.workflowVersion,
                  inputVersion: event.inputVersion,
                  executionId,
                  createdAt: now
                })
                .onConflictDoNothing()
                .run();
            })
          );
          delivered++;
        }
      }

      return delivered;
    })
  );
}

const snapshotCursors = new WeakMap<ServerContext, string>();

type SnapshotWorkflow = Workflow.Any & {
  readonly version: number;
  readonly poll: (
    id: string
  ) => Effect.Effect<
    Option.Option<Workflow.Result<unknown, unknown>>,
    never,
    WorkflowEngine.WorkflowEngine
  >;
};

/** Refresh domain snapshots from official replies; never schedule or recover execution here. */
export function refreshExecutionSnapshots(
  context: ServerContext,
  definitions: readonly SnapshotWorkflow[]
) {
  return Effect.gen(function* () {
    const rows = context.db.orm
      .select()
      .from(workflow_executions)
      .where(
        sql`(${workflow_executions.status} IN ('running','suspended','cancelling') OR EXISTS (SELECT 1 FROM workflow_retired_executions r WHERE r.execution_id=${workflow_executions.execution_id})) AND ${workflow_executions.execution_id} > ${snapshotCursors.get(context) ?? ''}`
      )
      .orderBy(workflow_executions.execution_id)
      .limit(100)
      .all();

    snapshotCursors.set(context, rows.length === 100 ? rows[rows.length - 1]!.execution_id : '');

    for (const row of rows) {
      const workflow = definitions.find(
        (definition) =>
          definition._tag === row.workflow_tag && definition.version === Number(row.version)
      );

      if (!workflow) {
        if (row.status === 'blocked') continue;

        yield* Effect.sync(() =>
          context.transaction(['workflows'], (tx) => {
            tx.db.orm
              .update(workflow_executions)
              .set({
                status: 'blocked',
                blocked_reason: 'unsupported',
                updated_at: BigInt(context.clock.currentTimeMillisUnsafe())
              })
              .where(eq(workflow_executions.execution_id, row.execution_id))
              .run();
          })
        );
        continue;
      }

      const retired = !!context.db.orm
        .select()
        .from(workflow_retired_executions)
        .where(eq(workflow_retired_executions.execution_id, row.execution_id))
        .get();

      if (row.cancellation_mode || retired) {
        yield* reconcileCancellation(
          context,
          workflow,
          row.execution_id,
          retired ? 'unsafe' : row.cancellation_mode!,
          false
        );
        continue;
      }

      const reply = yield* workflow.poll(row.execution_id);

      yield* Effect.sync(() =>
        context.transaction(['workflows'], (tx) => {
          const current = tx.db.orm
            .select()
            .from(workflow_executions)
            .where(eq(workflow_executions.execution_id, row.execution_id))
            .get();

          if (
            !current ||
            current.generation !== row.generation ||
            workflowStore(tx).retired(row.execution_id)
          )
            return;

          if (Option.isNone(reply)) return;

          const status = current.cancellation_mode
            ? 'cancelling'
            : reply.value._tag === 'Complete'
              ? 'completed'
              : 'suspended';
          const result = JSON.stringify(
            Schema.encodeSync(
              Schema.toCodecJson(
                Workflow.Result({
                  success: workflow.successSchema as Schema.Codec<unknown, unknown>,
                  error: workflow.errorSchema as Schema.Codec<unknown, unknown>
                })
              )
            )(reply.value)
          );

          if (current.status === status && current.result === result) return;

          tx.db.orm
            .update(workflow_executions)
            .set({ status, result, updated_at: BigInt(context.clock.currentTimeMillisUnsafe()) })
            .where(eq(workflow_executions.execution_id, row.execution_id))
            .run();
        })
      );
    }
  });
}
