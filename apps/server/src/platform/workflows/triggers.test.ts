import assert from 'node:assert/strict';
import { test } from 'node:test';

import { workflowEventSchema } from '@study/contracts/events';
import { workflow_executions, workflowReceipts } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Schema } from 'effect';
import { Workflow, WorkflowEngine } from 'effect/workflow';

import { ServerContext } from '#server/platform/database/context';

const openContext = (location: ReturnType<typeof createTestDatabase>): ServerContext => {
  const db = location.open();

  return new ServerContext(db);
};

import { recoverWorkflowEngine, workflowEngineLayer } from '#server/platform/workflows/engine';
import { emitEvent } from '#server/platform/workflows/events';
import { dispatchPending, validateTriggerGraph } from '#server/platform/workflows/triggers';
import type { Trigger } from '#server/platform/workflows/triggers';

const event = (id: string) =>
  Schema.decodeUnknownSync(workflowEventSchema)({
    type: 'SourceIndexed',
    eventId: id,
    causationId: null,
    correlationId: id,
    inputVersion: 1,
    depth: 0,
    projectId: 1n,
    sourceId: 2n,
    documentId: 3n
  });

const testWorkflow = Workflow.make('test/v1', {
  payload: { event: workflowEventSchema },
  idempotencyKey: ({ event }) => event.eventId
});

const trigger: Trigger = {
  subscription: 'source',
  event: 'SourceIndexed',
  workflowVersion: 1,
  workflow: testWorkflow,
  emits: [],
  enabled: () => true
};

test('automatic trigger cycles are rejected', () => {
  assert.throws(
    () =>
      validateTriggerGraph([
        { event: 'SourceIndexed', emits: ['MaterialPublished'] },
        { event: 'MaterialPublished', emits: ['SourceIndexed'] }
      ]),
    /cycle/i
  );
});

test('dispatch commits bounded executions and receipts and survives reopening', () => {
  const location = createTestDatabase();
  let context = openContext(location);

  try {
    context.transaction(() => {
      for (let i = 0; i < 3; i++) emitEvent(context, event(String(i)), i);
    });
    assert.equal(dispatchPending(context, [trigger], 10, 2), 2);
    context.close();
    context = openContext(location);
    assert.equal(dispatchPending(context, [trigger], 11, 2), 1);
    assert.equal(dispatchPending(context, [trigger], 12, 2), 0);
    assert.equal(context.db.orm.select().from(workflowReceipts).all().length, 3);
    assert.equal(context.db.orm.select().from(workflow_executions).all().length, 3);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('a disabled subscription does not starve an enabled subscription', () => {
  const location = createTestDatabase();
  const context = openContext(location);

  try {
    context.transaction(() => emitEvent(context, event('one'), 1));
    assert.equal(
      dispatchPending(
        context,
        [{ ...trigger, subscription: 'disabled', enabled: () => false }, trigger],
        2,
        1
      ),
      1
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('a scheduling failure rolls back execution and receipt together', () => {
  const location = createTestDatabase();
  const context = openContext(location);

  try {
    context.transaction(() => {
      emitEvent(context, event('one'), 1);
      emitEvent(context, event('two'), 2);
    });
    const throwing: Trigger = {
      ...trigger,
      subscription: 'second',
      enabled: () => {
        throw new Error('policy failed');
      }
    };

    assert.throws(() => dispatchPending(context, [trigger, throwing], 3), /policy failed/);
    assert.equal(context.db.orm.select().from(workflow_executions).all().length, 0);
    assert.equal(context.db.orm.select().from(workflowReceipts).all().length, 0);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('re-enabling a policy delivers its retained events', () => {
  const location = createTestDatabase();
  const context = openContext(location);
  let enabled = false;

  try {
    context.transaction(() => emitEvent(context, event('one'), 1));
    const policy = { ...trigger, enabled: () => enabled };

    assert.equal(dispatchPending(context, [policy], 2), 0);
    enabled = true;
    assert.equal(dispatchPending(context, [policy], 3), 1);
    assert.equal(dispatchPending(context, [policy], 4), 0);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('committed outbox executions recover through the native engine after reopening', async () => {
  const location = createTestDatabase();
  let context = openContext(location);
  let calls = 0;

  try {
    context.transaction(() => emitEvent(context, event('recover'), 1));
    assert.equal(dispatchPending(context, [trigger], 2), 1);
    context.close();
    context = openContext(location);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(testWorkflow, () =>
            Effect.sync(() => {
              calls++;
            })
          );
          yield* recoverWorkflowEngine(context, engine, [testWorkflow]);

          for (let attempt = 0; attempt < 100; attempt++) {
            if (context.db.orm.select().from(workflow_executions).all()[0]?.status === 'completed')
              break;

            yield* Effect.sleep('5 millis');
          }

          assert.equal(
            context.db.orm.select().from(workflow_executions).all()[0]?.status,
            'completed'
          );
          yield* recoverWorkflowEngine(context, engine, [testWorkflow]);
        }).pipe(Effect.provide(workflowEngineLayer(context)))
      )
    );
    assert.equal(calls, 1);
    assert.equal(context.db.orm.select().from(workflowReceipts).all().length, 1);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('subscription validation rejects duplicates and excessive automatic fanout', () => {
  const location = createTestDatabase();
  const context = openContext(location);

  try {
    assert.throws(() => dispatchPending(context, [trigger, trigger], 1), /duplicate/);
    assert.throws(
      () =>
        validateTriggerGraph([
          { event: 'SourceIndexed', emits: Array(17).fill('MaterialPublished') }
        ]),
      /fanout/
    );
  } finally {
    context.close();
    location.cleanup();
  }
});

test('material publication events identify a published material version', () => {
  const value = {
    type: 'MaterialPublished',
    eventId: 'material',
    causationId: null,
    correlationId: 'material',
    inputVersion: 1,
    depth: 0,
    projectId: 1n,
    materialId: 2n,
    materialVersionId: 3n
  };
  const decoded = Schema.decodeUnknownSync(workflowEventSchema)(value);

  assert.equal(decoded.type, 'MaterialPublished');
  assert.equal('materialVersionId' in decoded && decoded.materialVersionId, 3n);
  assert.throws(() =>
    Schema.decodeUnknownSync(workflowEventSchema)({
      ...value,
      materialVersionId: undefined,
      artifactId: 2n
    })
  );
});

test('registered workflows accept canonical failure values', async () => {
  const { sourceIndexedWorkflow } = await import('#server/features/materials/workflows/index');
  const failure = { kind: 'cancelled', message: 'superseded', retryAfterMs: null };

  assert.deepEqual(Schema.decodeUnknownSync(sourceIndexedWorkflow.errorSchema)(failure), failure);
});

test('disabled subscriptions leave events unscheduled', () => {
  const location = createTestDatabase();
  const context = openContext(location);

  try {
    context.transaction(() => emitEvent(context, event('disabled'), 1));
    assert.equal(dispatchPending(context, [{ ...trigger, enabled: () => false }], 2), 0);
    assert.equal(context.db.orm.select().from(workflow_executions).all().length, 0);
    assert.equal(context.db.orm.select().from(workflowReceipts).all().length, 0);
  } finally {
    context.close();
    location.cleanup();
  }
});
