import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StudyError } from '@study/contracts/errors';
import { eq, sql } from '@study/db';
import { workflow_executions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Metric, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';

import { ServerContext } from '#server/platform/database/context';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { PublicationGuard, withPublicationGuard } from '#server/platform/workflows/publication';
import { workflowStore } from '#server/platform/workflows/store';

const guarded = Effect.gen(function* () {
  return yield* PublicationGuard;
});

function publicationTypeAssertions() {
  // @ts-expect-error PublicationGuard must be supplied before running the effect.
  void Effect.runPromise(guarded);
}

void publicationTypeAssertions;

test('missing activity ownership is rejected', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());

  try {
    const error = await Effect.runPromise(Effect.flip(withPublicationGuard(context, guarded)));

    assert.ok(error instanceof StudyError);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('publication is fenced within the transaction by the captured activity lease', async () => {
  const location = createTestDatabase();
  const context = new ServerContext(location.open());
  const store = workflowStore(context);

  context.db.orm.run(sql`CREATE TABLE publication_probe (value INTEGER)`);
  let assertionsCompleted = false;
  const workflow = Workflow.make('publication-test', {
    payload: { id: Schema.String },
    idempotencyKey: ({ id }) => id
  });
  const activity = Activity.make({
    name: 'publish',
    execute: withPublicationGuard(
      context,
      Effect.gen(function* () {
        const guard = yield* PublicationGuard;

        assert.throws(() => guard.assert(), StudyError);
        context.transaction(() => {
          guard.assert();
          context.db.orm.run(sql`INSERT INTO publication_probe VALUES (1)`);
        });
        store.interrupt('publication', 'safe');
        assert.throws(() => context.transaction(() => guard.assert()), StudyError);
        context.db.orm
          .update(workflow_executions)
          .set({ result: null })
          .where(eq(workflow_executions.execution_id, 'publication'))
          .run();
        context.db.orm
          .update(workflow_executions)
          .set({ status: 'suspended' })
          .where(eq(workflow_executions.execution_id, 'publication'))
          .run();
        assert.throws(() => context.transaction(() => guard.assert()), StudyError);
        context.db.orm
          .update(workflow_executions)
          .set({ status: 'running' })
          .where(eq(workflow_executions.execution_id, 'publication'))
          .run();
        context.db.orm
          .update(workflow_executions)
          .set({ updated_at: 0n })
          .where(eq(workflow_executions.execution_id, 'publication'))
          .run();
        assert.throws(() => context.transaction(() => guard.assert()), StudyError);
        assert.equal(store.claim('publication', 'replacement'), true);
        assert.throws(() => context.transaction(() => guard.assert()), StudyError);
        assert.throws(
          () =>
            context.transaction(() => {
              context.db.orm.run(sql`INSERT INTO publication_probe VALUES (2)`);
              guard.assert();
            }),
          StudyError
        );
        assert.equal(context.db.orm.all(sql`SELECT value FROM publication_probe`).length, 1);
        context.db.orm
          .delete(workflow_executions)
          .where(eq(workflow_executions.execution_id, 'publication'))
          .run();
        assert.throws(() => context.transaction(() => guard.assert()), StudyError);
        assertionsCompleted = true;
      })
    ).pipe(Effect.orDie)
  });

  try {
    const metrics = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () => activity);
          yield* Effect.exit(
            engine.execute(workflow, { executionId: 'publication', payload: { id: 'publication' } })
          );

          return yield* Metric.snapshot;
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      ).pipe(Effect.provideService(Metric.MetricRegistry, new Map()))
    );

    assert.equal(assertionsCompleted, true);
    const rejected = metrics.find((metric) => metric.id === 'study.publication.rejection');

    assert.equal(rejected?.type, 'Counter');

    if (rejected?.type === 'Counter') assert.equal(rejected.state.count, 7);
  } finally {
    context.close();
    location.cleanup();
  }
});
