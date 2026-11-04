import assert from 'node:assert/strict';

import { sourceProcessingRequestedSchema } from '@study/contracts/events';
import { sourceIdSchema } from '@study/contracts/ids';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Deferred, Effect, Layer } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';

import { Workflows } from '#server/features/workflows/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';

import { cancelExecution } from './control.ts';
import { workflowEngineLayer } from './engine.ts';

testStable(
  'unsafe control interrupts a provider fiber after its durable source capture was retired and scrubbed',
  async () => {
    const location = createTestDatabase();
    const context = new ServerContext(location.open());
    const workflow = Workflow.make('retired-source-control-test', {
      payload: { event: sourceProcessingRequestedSchema },
      idempotencyKey: ({ event }) => event.eventId
    });
    const id = executionIdSchema.make('retired-source-provider');
    const event = {
      type: 'SourceProcessingRequested' as const,
      eventId: 'source-event',
      causationId: null,
      correlationId: 'source-request',
      inputVersion: 1,
      depth: 0,
      sourceId: sourceIdSchema.make(1n),
      requestId: 'source-request'
    };
    let calls = 0;
    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const engine = yield* WorkflowEngine.WorkflowEngine;
            const started = yield* Deferred.make<void>();
            const stopped = yield* Deferred.make<void>();
            yield* engine.register(workflow, () =>
              Activity.make({
                name: 'provider',
                execute: Effect.gen(function* () {
                  calls++;
                  yield* Deferred.succeed(started, undefined);
                  yield* Effect.never;
                }).pipe(Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)))
              })
            );
            yield* engine.execute(workflow, { executionId: id, payload: { event }, discard: true });
            yield* Deferred.await(started);
            yield* transaction((tx) => {
              Workflows.retireCorrelations(tx, [event.correlationId], [event.type]);
              Workflows.scrubRetiredCorrelations(tx, [event.correlationId]);
            });
            assert.equal(
              context.db.orm.get(
                sql`SELECT status FROM workflow_executions WHERE execution_id=${id}`
              )?.status,
              'cancelled'
            );
            yield* cancelExecution(context, [workflow], { id, mode: 'unsafe' });
            yield* Deferred.await(stopped).pipe(Effect.timeout('5 seconds'));
            yield* engine.resume(workflow, id);
          }).pipe(
            Effect.provide(
              Layer.merge(workflowEngineLayer(context), Layer.succeed(Database, { store: context }))
            )
          )
        )
      );
      assert.equal(calls, 1);
      assert.deepEqual(
        {
          ...context.db.orm.get(
            sql`SELECT payload,result,owner_token,status FROM workflow_executions WHERE execution_id=${id}`
          )
        },
        { payload: '{}', result: null, owner_token: null, status: 'cancelled' }
      );
      assert.equal(
        context.db.orm.get(sql`SELECT 1 FROM workflow_activities WHERE execution_id=${id}`),
        undefined
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);
