import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StudyError } from '@study/contracts/errors';
import type { SourceId } from '@study/contracts/ids';
import { eq, sql } from '@study/db';
import { workflow_executions } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Metric, Schema } from 'effect';
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow';

import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import {
  defineStore,
  publicationTransaction,
  storeMutation
} from '#server/platform/definitions/define-store';
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

  function* verifyPublicationFencing() {
    const guard = yield* PublicationGuard;
    const secondLocation = createTestDatabase();
    const second = new ServerContext(secondLocation.open());
    const probe = defineStore({
      name: 'test/PublicationProbe',
      entity: { singular: 'probe', plural: 'probes' },
      make: ({ db }) => ({
        queries: {},
        mutations: {
          insert: storeMutation({
            input: Schema.String,
            output: Schema.Void,
            run: (key) => {
              db.orm.run(
                sql`INSERT INTO preferences(scope,key,value) VALUES('publication-context',${key},'null')`
              );
            }
          })
        }
      })
    });
    let invoked = false;

    const mismatched = publicationTransaction((tx) => {
      invoked = true;
      tx.store(probe).insert('wrong-database');
      tx.emit({
        type: 'SourceDeleted',
        eventId: 'wrong-database-publication',
        causationId: null,
        correlationId: 'wrong-database-publication',
        inputVersion: 1,
        depth: 0,
        sourceId: 1n as SourceId
      });
    });

    try {
      assert.throws(
        () =>
          context.transaction(() => {
            context.db.orm.run(sql`INSERT INTO publication_probe VALUES (99)`);
            const rejected = Effect.runSync(
              mismatched.pipe(
                Effect.provideService(PublicationGuard, guard),
                Effect.provideService(Database, { store: second }),
                Effect.flip
              )
            );

            assert.equal(rejected.kind, 'cancelled');

            throw new Error('rollback owner database');
          }),
        /rollback owner database/
      );
      assert.equal(invoked, false);
      assert.equal(
        second.db.orm.get(sql`SELECT key FROM preferences WHERE scope='publication-context'`),
        undefined
      );
      assert.equal(
        second.db.orm.get(
          sql`SELECT event_id FROM workflow_events WHERE event_id='wrong-database-publication'`
        ),
        undefined
      );
      assert.equal(context.db.orm.all(sql`SELECT value FROM publication_probe`).length, 0);

      yield* publicationTransaction((tx) => tx.store(probe).insert('same-database')).pipe(
        Effect.provideService(Database, { store: context })
      );
      assert.equal(
        context.db.orm.all(sql`SELECT key FROM preferences WHERE scope='publication-context'`)
          .length,
        1
      );
    } finally {
      second.close();
      secondLocation.cleanup();
    }

    assert.throws(() => guard.assert(context), StudyError);
    context.transaction(() => {
      guard.assert(context);
      context.db.orm.run(sql`INSERT INTO publication_probe VALUES (1)`);
    });
    store.interrupt('publication', 'safe');
    assert.throws(() => context.transaction(() => guard.assert(context)), StudyError);
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
    assert.throws(() => context.transaction(() => guard.assert(context)), StudyError);
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
    assert.throws(() => context.transaction(() => guard.assert(context)), StudyError);
    assert.equal(store.claim('publication', 'replacement'), true);
    assert.throws(() => context.transaction(() => guard.assert(context)), StudyError);
    assert.throws(
      () =>
        context.transaction(() => {
          context.db.orm.run(sql`INSERT INTO publication_probe VALUES (2)`);
          guard.assert(context);
        }),
      StudyError
    );
    assert.equal(context.db.orm.all(sql`SELECT value FROM publication_probe`).length, 1);
    context.db.orm
      .delete(workflow_executions)
      .where(eq(workflow_executions.execution_id, 'publication'))
      .run();
    assert.throws(() => context.transaction(() => guard.assert(context)), StudyError);
    assertionsCompleted = true;
  }

  const activity = Activity.make({
    name: 'publish',
    execute: withPublicationGuard(context, Effect.gen(verifyPublicationFencing)).pipe(Effect.orDie)
  });

  try {
    const metrics = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(workflow, () => activity);
          yield* Effect.exit(
            engine.execute(workflow, {
              executionId: 'publication',
              payload: { id: 'publication' }
            })
          );

          return yield* Metric.snapshot;
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      ).pipe(Effect.provideService(Metric.MetricRegistry, new Map()))
    );

    assert.equal(assertionsCompleted, true);
    const rejected = metrics.find((metric) => metric.id === 'study.publication.rejection');

    assert.equal(rejected?.type, 'Counter');

    if (rejected?.type === 'Counter') assert.equal(rejected.state.count, 8);
  } finally {
    context.close();
    location.cleanup();
  }
});
