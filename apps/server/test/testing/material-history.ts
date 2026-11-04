/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Drives exact history pruning and source projection through native Workflows.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Shares real acceptance, event lookup and cleanup across retention regression suites.   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Fixtures own SQLite lifetime; production services and native guards own all mutations.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { MaterialId, ContentSnapshotId } from '@study/contracts/ids';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { WorkflowEngine } from 'effect/workflow';
import { assert } from 'vite-plus/test';

import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import {
  materialHistoryWorkflow,
  materialHistoryHandler
} from '#server/features/materials/workflows/history';
import {
  sourceIngestionWorkflow,
  sourceIngestionHandler,
  sourceCorrectionWorkflow,
  sourceCorrectionHandler
} from '#server/features/sources/workflows/index';
import { decodeEvent } from '#server/platform/workflows/events';
import type { MaterialDeletionFixture } from '#testing/material-deletion';

function historyEvent(f: MaterialDeletionFixture, operationId: string) {
  const event = f.context.db.orm
    .select()
    .from(s.workflowEvents)
    .where(eq(s.workflowEvents.type, 'MaterialHistoryPruneRequested'))
    .all()
    .map((row) => decodeEvent(row.payload))
    .findLast(
      (event) => event.type === 'MaterialHistoryPruneRequested' && event.operationId === operationId
    );

  assert.ok(event?.type === 'MaterialHistoryPruneRequested');

  return event;
}

export function cleanupHistory(f: MaterialDeletionFixture, operationId: string) {
  const event = historyEvent(f, operationId);

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const engine = yield* WorkflowEngine.WorkflowEngine;

        yield* engine.register(materialHistoryWorkflow, materialHistoryHandler);

        return yield* engine.execute(materialHistoryWorkflow, {
          executionId: `history-test/${event.eventId}`,
          payload: { event }
        });
      }).pipe(Effect.provide(f.services()))
    )
  );
}

export function acceptHistory(
  f: MaterialDeletionFixture,
  materialId: MaterialId,
  operationId: string
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });

        const scope = { materialId, policy: { keepLatest: 1 } };

        const preview = yield* client('materials.previewHistoryPrune', scope);

        return yield* client('materials.requestHistoryPrune', {
          ...scope,
          operationId,
          candidateIds: preview.candidateIds,
          token: preview.token
        });
      }).pipe(Effect.provide(MaterialsRpcLive.pipe(Layer.provideMerge(f.domain()))))
    )
  );
}

export function processSource(f: MaterialDeletionFixture, correction = false) {
  const row = f.context.db.orm
    .select()
    .from(s.workflowEvents)
    .where(
      eq(
        s.workflowEvents.type,
        correction ? 'SourceCorrectionRequested' : 'SourceProcessingRequested'
      )
    )
    .all()
    .at(-1);

  const event = row === undefined ? undefined : decodeEvent(row.payload);

  assert.ok(
    event?.type === 'SourceProcessingRequested' || event?.type === 'SourceCorrectionRequested'
  );

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const engine = yield* WorkflowEngine.WorkflowEngine;

        yield* engine.register(sourceIngestionWorkflow, sourceIngestionHandler);

        yield* engine.register(sourceCorrectionWorkflow, sourceCorrectionHandler);

        const documentId: ContentSnapshotId =
          event.type === 'SourceCorrectionRequested'
            ? yield* engine.execute(sourceCorrectionWorkflow, {
                executionId: `correction/${event.eventId}`,
                payload: { event }
              })
            : yield* engine.execute(sourceIngestionWorkflow, {
                executionId: `ingestion/${event.eventId}`,
                payload: { event }
              });

        const indexed = f.context.db.orm
          .select()
          .from(s.workflowEvents)
          .where(eq(s.workflowEvents.type, 'SourceIndexed'))
          .all()
          .filter((row) => row.payload !== '{}')
          .map((row) => decodeEvent(row.payload))
          .findLast((e) => e.type === 'SourceIndexed' && e.documentId === documentId);

        assert.ok(indexed?.type === 'SourceIndexed');

        return { documentId };
      }).pipe(Effect.provide(f.services()))
    )
  );
}
