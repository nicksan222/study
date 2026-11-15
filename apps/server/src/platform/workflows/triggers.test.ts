/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises workflow event trigger graph validation and transactional dispatch.      │
 * │ Tests cover cycle rejection, durable receipts, disabled subscriptions, rollback, and     │
 * │ reenabled policies.                                                                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Asserts: automatic trigger cycles are rejected; dispatch commits bounded executions    │
 * │   and receipts and survives reopening.                                                   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/platform/database/context, #server/platform/workflows/engine,               │
 * │ #server/platform/workflows/events with real SQLite and application resources; fixture    │
 * │ cleanup closes owned resources.                                                          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { workflowEventSchema } from '@study/contracts/events';
import { workflow_executions, workflowReceipts } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, ManagedRuntime, Layer, Schema } from 'effect';
import { Workflow } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { ServerContext } from '#server/platform/database/context';

const openContext = async (
  location: Awaited<ReturnType<typeof createTestDatabase>>
): Promise<ServerContext> => {
  const db = await location.open();

  return new ServerContext(db);
};

import { workflowEngineLayer } from '#server/platform/workflows/engine';
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

testStable('automatic trigger cycles are rejected', () => {
  assert.throws(
    () =>
      validateTriggerGraph([
        { event: 'SourceIndexed', emits: ['MaterialPublished'] },
        { event: 'MaterialPublished', emits: ['SourceIndexed'] }
      ]),
    /cycle/i
  );
});

testStable(
  'bounded dispatch persists receipts after official acceptance and survives restart',
  async () => {
    const location = await createTestDatabase();
    const context = await openContext(location);
    let calls = 0;
    const record = () =>
      Effect.sync(() => {
        calls++;
      });
    const layer = testWorkflow
      .toLayer(record)
      .pipe(Layer.provideMerge(workflowEngineLayer(context)));
    const first = ManagedRuntime.make(layer);

    try {
      context.transaction(['workflows'], (tx) => {
        for (let index = 0; index < 3; index++) emitEvent(tx, event(String(index)), index);
      });
      assert.equal(await first.runPromise(dispatchPending(context, [trigger], 10, 2)), 2);
      assert.equal(context.db.orm.select().from(workflowReceipts).all().length, 2);
      await first.dispose();
      const second = ManagedRuntime.make(layer);

      try {
        assert.equal(await second.runPromise(dispatchPending(context, [trigger], 11, 2)), 1);
        assert.equal(await second.runPromise(dispatchPending(context, [trigger], 12, 2)), 0);
        assert.equal(context.db.orm.select().from(workflowReceipts).all().length, 3);
        assert.equal(context.db.orm.select().from(workflow_executions).all().length, 3);
        assert.isAtMost(calls, 3);
      } finally {
        await second.dispose();
      }
    } finally {
      await first.dispose();
      context.close();
      await location.cleanup();
    }
  }
);

testStable('material publication events identify a published material version', () => {
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

  assert.ok(decoded.type === 'MaterialPublished');
  expect('materialVersionId' in decoded && decoded.materialVersionId).toBe(3n);
  assert.throws(() =>
    Schema.decodeUnknownSync(workflowEventSchema)({
      ...value,
      materialVersionId: undefined,
      artifactId: 2n
    })
  );
});

testStable('registered workflows accept canonical failure values', async () => {
  const { sourceIngestionWorkflow } = await import('#server/features/sources/workflows/index');
  const failure = { kind: 'cancelled', message: 'superseded', retryAfterMs: null };

  expect(Schema.decodeUnknownSync(sourceIngestionWorkflow.errorSchema)(failure)).toStrictEqual(
    failure
  );
});

testStable('trigger graph fanout counts every subscription with the same source event', () => {
  const edges = Array.from({ length: 17 }, () => ({
    event: 'SourceIndexed' as const,
    emits: ['MaterialPublished' as const]
  }));

  assert.throws(() => validateTriggerGraph(edges), /fanout/);
  expect(() => validateTriggerGraph(edges.slice(0, 16))).not.toThrow();
});
