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

import { workflow_executions, workflow_retired_executions } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, ManagedRuntime, Schema, Option, Context, Scope, Exit } from 'effect';
import {
  ClusterSchema,
  EntityAddress,
  EntityId,
  EntityType,
  MessageStorage,
  Sharding
} from 'effect/cluster';
import { DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow';
import { expect } from 'vite-plus/test';

import { ServerContext } from '#server/platform/database/context';
import { reconcileCancellation } from '#server/platform/workflows/cancellation';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { workflowStore, scrubRetiredExecution } from '#server/platform/workflows/store';
import { admitTestExecution } from '#testing/workflow-admission';

const workflow = Workflow.make('cancel-recovery-test', {
  payload: { id: Schema.String },
  idempotencyKey: ({ id }) => id
});

for (const accepted of [false, true, 'completed'] as const)
  testStable(
    `cancel intent survives restart with accepted=${accepted} and retirement clears official messages`,
    async () => {
      const location = await createTestDatabase();
      const context = new ServerContext(await location.open());
      let runtime = ManagedRuntime.make(workflowEngineLayer(context));
      const id = 'cancel-recovery';
      let scope = Scope.makeUnsafe();

      admitTestExecution(context, workflow, id, { id });

      try {
        if (accepted)
          await runtime.runPromise(
            Effect.gen(function* () {
              const engine = yield* WorkflowEngine.WorkflowEngine;

              yield* engine.register(workflow, () =>
                accepted === 'completed'
                  ? Effect.void
                  : DurableDeferred.await(DurableDeferred.make('waiting'))
              );
              yield* engine.execute(workflow, {
                executionId: id,
                payload: { id },
                discard: accepted !== 'completed'
              });
            }).pipe(Effect.provideService(Scope.Scope, scope))
          );

        if (accepted === 'completed')
          context.db.orm.update(workflow_executions).set({ status: 'completed' }).run();

        workflowStore(context).requestCancellation(id, 'unsafe');
        context.db.orm
          .insert(workflow_retired_executions)
          .values({ execution_id: id, correlation_id: 'deleted' })
          .run();
        await Effect.runPromise(Scope.close(scope, Exit.void));
        await runtime.dispose();
        scope = Scope.makeUnsafe();
        runtime = ManagedRuntime.make(workflowEngineLayer(context));
        await runtime.runPromise(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;

            yield* engine.register(workflow, () =>
              DurableDeferred.await(DurableDeferred.make('waiting'))
            );
            yield* Effect.all(
              [
                reconcileCancellation(context, workflow, id, 'unsafe', true),
                reconcileCancellation(context, workflow, id, 'unsafe', true)
              ],
              { concurrency: 'unbounded' }
            );
            const sharding = yield* Sharding.Sharding;
            const storage = yield* MessageStorage.MessageStorage;
            const entityId = EntityId.make(id);
            const address = EntityAddress.make({
              entityType: EntityType.make(`Workflow/${workflow._tag}`),
              entityId,
              shardId: sharding.getShardId(
                entityId,
                Context.get(workflow.annotations, ClusterSchema.ShardGroup)(entityId)
              )
            });

            expect(
              Option.isNone(yield* storage.requestIdForPrimaryKey({ address, tag: 'run', id: '' }))
            ).toBe(true);
          }).pipe(Effect.timeout('5 seconds'), Effect.provideService(Scope.Scope, scope))
        );
        expect(context.db.orm.select().from(workflow_executions).get()?.status).toBe(
          accepted === 'completed' ? 'completed' : 'cancelled'
        );
        scrubRetiredExecution(context.db, id);
        scrubRetiredExecution(context.db, id);
        expect(workflowStore(context).execution(id)?.status).toBe(
          accepted === 'completed' ? 'completed' : 'cancelled'
        );
      } finally {
        await Effect.runPromise(Scope.close(scope, Exit.void));
        await runtime.dispose();
        context.close();
        await location.cleanup();
      }
    }
  );
