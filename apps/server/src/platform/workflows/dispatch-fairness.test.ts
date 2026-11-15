/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies terminal domain intent cannot monopolize bounded dispatch.                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Checks eligible work passes a full cancelled batch.                                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses official SQL acceptance with canonical events and durable receipts.                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { workflowEventSchema } from '@study/contracts';
import { workflow_executions, workflowReceipts } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer, ManagedRuntime, Schema } from 'effect';
import { Workflow } from 'effect/workflow';
import { expect } from 'vite-plus/test';

import { ServerContext } from '#server/platform/database/context';
import { workflowEngineLayer } from '#server/platform/workflows/engine';
import { emitEvent } from '#server/platform/workflows/events';
import { admitPending, dispatchPending } from '#server/platform/workflows/triggers';
import type { Trigger } from '#server/platform/workflows/triggers';

for (const reason of ['cancelled', 'depth'] as const)
  testStable(`a full batch of ${reason} intent cannot starve a subsequent event`, async () => {
    const location = await createTestDatabase();
    const db = await location.open();
    const context = new ServerContext(db);
    const workflow = Workflow.make('fair-dispatch/v1', {
      payload: { event: workflowEventSchema },
      idempotencyKey: ({ event }) => event.eventId
    });
    const trigger: Trigger = {
      subscription: 'fair',
      event: 'SourceIndexed',
      workflowVersion: 1,
      workflow,
      emits: [],
      enabled: () => true
    };
    const runtime = ManagedRuntime.make(
      workflow.toLayer(() => Effect.void).pipe(Layer.provideMerge(workflowEngineLayer(context)))
    );
    const emit = (id: string, createdAt: number, depth = 0) =>
      context.transaction(['workflows'], (tx) =>
        emitEvent(
          tx,
          Schema.decodeUnknownSync(workflowEventSchema)({
            type: 'SourceIndexed',
            eventId: id,
            causationId: null,
            correlationId: id,
            inputVersion: 1,
            depth,
            projectId: 1n,
            sourceId: 2n,
            documentId: 3n
          }),
          createdAt
        )
      );

    try {
      for (let index = 0; index < 100; index++) emit(`old-${index}`, 1, reason === 'depth' ? 8 : 0);

      admitPending(context, [trigger], 1);
      db.orm
        .update(workflow_executions)
        .set({ status: 'cancelled', cancellation_mode: 'safe' })
        .run();
      emit('new', 2);
      expect(await runtime.runPromise(dispatchPending(context, [trigger], 2))).toBe(1);
      expect(
        db.orm
          .select()
          .from(workflowReceipts)
          .all()
          .map((row) => row.eventId)
      ).toEqual(['new']);
    } finally {
      await runtime.dispose();
      db.close();
      await location.cleanup();
    }
  });
