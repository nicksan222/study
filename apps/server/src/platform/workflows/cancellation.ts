/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reconciles durable cancellation against official persisted execution state.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Completes native interruption before retiring private messages and replies.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This serializes admission; official Effect services own execution and recovery.          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { Schema } from 'effect';
import { Context, Effect, Option, Schedule } from 'effect';
import {
  ClusterSchema,
  EntityAddress,
  EntityId,
  EntityType,
  MessageStorage,
  Sharding
} from 'effect/cluster';
import { WorkflowEngine } from 'effect/workflow';
import type { Workflow } from 'effect/workflow';

import type { ServerContext } from '#server/platform/database/context';

import { withDispatchPermit } from './admission.ts';
import { workflowStore } from './store.ts';

/** Repeated delivery is safe; restart keeps intent until cleanup succeeds. */
export function reconcileCancellation(
  context: ServerContext,
  workflow: Workflow.Any,
  id: string,
  mode: 'safe' | 'unsafe',
  wait: boolean
) {
  return Effect.gen(function* () {
    const dispatched = yield* withDispatchPermit(
      context,
      Effect.gen(function* () {
        yield* Effect.sync(() => workflowStore(context).requestCancellation(id, mode));
        const engine = yield* WorkflowEngine.WorkflowEngine;
        const sharding = yield* Sharding.Sharding;
        const storage = yield* MessageStorage.MessageStorage;
        const entityId = EntityId.make(id);
        const shardGroup = Context.get(workflow.annotations, ClusterSchema.ShardGroup)(entityId);
        const address = EntityAddress.make({
          entityType: EntityType.make(`Workflow/${workflow._tag}`),
          entityId,
          shardId: sharding.getShardId(entityId, shardGroup)
        });
        const accepted = yield* storage.requestIdForPrimaryKey({ address, tag: 'run', id: '' });

        if (Option.isNone(accepted)) {
          yield* Effect.sync(() => workflowStore(context).completeCancellation(id));

          return undefined;
        }

        return { engine, storage, address };
      })
    );

    if (!dispatched) return;

    const { engine, storage, address } = dispatched;

    yield* mode === 'safe' ? engine.interrupt(workflow, id) : engine.interruptUnsafe(workflow, id);
    const poll = engine.poll(
      workflow as Workflow.Workflow<
        string,
        Workflow.AnyStructSchema,
        typeof Schema.Unknown,
        typeof Schema.Unknown
      >,
      id
    );
    const reply = yield* wait
      ? poll.pipe(
          Effect.repeat({
            while: (result) => Option.isNone(result) || result.value._tag === 'Suspended',
            schedule: Schedule.spaced('25 millis')
          })
        )
      : poll;

    if (Option.isNone(reply) || reply.value._tag === 'Suspended') return;

    if (workflowStore(context).retired(id)) yield* storage.clearAddress(address);

    yield* Effect.sync(() => workflowStore(context).completeCancellation(id));
  });
}
