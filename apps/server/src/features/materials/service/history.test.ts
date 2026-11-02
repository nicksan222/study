/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises exact Material deletion through migrated SQLite, native RPC and native   │
 * │ Workflow.                                                                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact deletion behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { historyPolicySchema, historyVersionIdsSchema } from '@study/contracts/materials/history';
import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Effect, Layer, Schema } from 'effect';
import { RpcTest } from 'effect/rpc';
import { WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import {
  materialHistoryWorkflow,
  materialHistoryHandler
} from '#server/features/materials/workflows/history';
import { decodeEvent } from '#server/platform/workflows/events';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument, acceptMaterialDeletion } from '#testing/material-deletion';
import type { MaterialDeletionFixture } from '#testing/material-deletion';
import { withTestPublication } from '#testing/publication';

function cleanup(f: MaterialDeletionFixture, operationId: string) {
  const event = f.context.db.orm
    .select()
    .from(s.workflowEvents)
    .where(eq(s.workflowEvents.type, 'MaterialHistoryPruneRequested'))
    .all()
    .map((r) => decodeEvent(r.payload))
    .findLast((e) => e.type === 'MaterialHistoryPruneRequested' && e.operationId === operationId);
  assert.ok(event?.type === 'MaterialHistoryPruneRequested');
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

test('retention policy and explicit candidate scope have positive finite bounds', () => {
  const policy = Schema.decodeUnknownSync(historyPolicySchema);
  assert.deepEqual(policy({ keepLatest: 1 }), { keepLatest: 1 });
  assert.deepEqual(policy({ keepLatest: 1000 }), { keepLatest: 1000 });
  for (const keepLatest of [0, -1, 1001, 1.5]) assert.throws(() => policy({ keepLatest }));
  const ids = Schema.decodeUnknownSync(historyVersionIdsSchema);
  assert.throws(() => ids([1n, 1n]));
  assert.throws(() => ids(Array.from({ length: 101 }, (_, i) => BigInt(i + 1))));
});

test('native RPC previews referenced exact history, prunes it and preserves the current Material and derivative', async () => {
  const f = await documentTransformFixture();
  try {
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const m = yield* Materials;
        const root = yield* m.create({
          title: 'History',
          content: { kind: 'document', ...deletionDocument('HISTORY_MARKER_REMOVE') },
          publish: true
        });
        const kept = yield* m.createVersion({
          materialId: root.id,
          content: { kind: 'document', ...deletionDocument('CURRENT_MARKER_KEEP') },
          publish: true
        });
        const derivative = yield* m.create({
          title: 'Copy',
          content: { kind: 'document', ...deletionDocument('COPY_MARKER_KEEP') },
          inputs: [root.version.id],
          publish: true
        });
        const current = yield* m.material({ id: root.id });
        const client = yield* RpcTest.makeClient(MaterialsRpc).pipe(
          Effect.provide(MaterialsRpcLive),
          Effect.provide(Layer.succeed(Materials, m))
        );
        const scope = { materialId: root.id, policy: { keepLatest: 1 } };
        const preview = yield* client('materials.previewHistoryPrune', scope);
        assert.deepEqual(preview.candidateIds, [root.version.id]);
        assert.ok(preview.references.some((r) => r.dependentVersionId === derivative.version.id));
        assert.ok(preview.removedBodyBytes > 0n);
        const input = {
          ...scope,
          operationId: 'history-rpc',
          candidateIds: preview.candidateIds,
          token: preview.token
        };
        const accepted = yield* client('materials.requestHistoryPrune', input);
        assert.equal(accepted.status, 'pending');
        assert.deepEqual(yield* client('materials.requestHistoryPrune', input), accepted);
        assert.equal(
          (yield* Effect.flip(m.materialVersion({ id: root.version.id }))).kind,
          'not_found'
        );
        const evidence = yield* m.resolveEvidence({
          kind: 'anchor',
          versionId: root.version.id,
          anchor: { type: 'authored' },
          quote: 'HISTORY'
        });
        assert.equal(evidence.availability, 'unavailable');
        if (evidence.availability === 'unavailable')
          assert.equal(evidence.reason, 'version_pruned');
        return { root, kept, current, derivative, input };
      }).pipe(Effect.provide(f.domain()))
    );
    await cleanup(f, saved.input.operationId);
    await Effect.runPromise(
      Effect.gen(function* () {
        const m = yield* Materials;
        assert.equal(
          (yield* m.historyPrune({ operationId: saved.input.operationId })).status,
          'completed'
        );
        assert.deepEqual(yield* m.material({ id: saved.root.id }), saved.current);
        assert.equal(
          (yield* m.materialVersion({ id: saved.derivative.version.id })).id,
          saved.derivative.version.id
        );
        assert.equal(
          (yield* m.inputs({ id: saved.derivative.version.id, limit: 30 })).items[0]!.availability,
          'unavailable'
        );
        const history = yield* m.materialVersions({ materialId: saved.root.id, limit: 30 });
        assert.equal(
          history.items.find((v) => v.id === saved.root.version.id)?.availability,
          'unavailable'
        );
        assert.equal(
          (yield* m.materialVersions({
            materialId: saved.root.id,
            cursor: saved.root.version.id,
            limit: 30
          })).items.length,
          0
        );
        assert.equal(
          (yield* Effect.flip(
            m.undoDocument({
              materialId: saved.root.id,
              expectedVersionId: saved.kept.id,
              restoreVersionId: saved.root.version.id,
              undoKey: 'restore-pruned'
            })
          )).kind,
          'not_found'
        );
        assert.deepEqual(
          yield* m.requestHistoryPrune(saved.input),
          yield* m.historyPrune({ operationId: saved.input.operationId })
        );
      }).pipe(Effect.provide(f.domain()))
    );
    const markerRows = f.context.db.orm.all(
      sql`SELECT content,text FROM blocks WHERE text LIKE '%HISTORY_MARKER_REMOVE%'`
    );
    assert.deepEqual(markerRows, []);
    assert.equal(f.context.db.orm.select().from(s.material_deletion_members).all().length, 0);
    assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
  } finally {
    await f.close();
  }
});

test('preview invalidates on new content, scope cannot expand, drafts are protected and no-op is explicit', async () => {
  const f = await documentTransformFixture();
  try {
    const input = await Effect.runPromise(
      Effect.gen(function* () {
        const m = yield* Materials;
        const root = yield* m.create({
          title: 'Bounds',
          content: { kind: 'document', ...deletionDocument('old') },
          publish: true
        });
        const scope = { materialId: root.id, policy: { keepLatest: 1 } };
        const first = yield* m.previewHistoryPrune(scope);
        assert.deepEqual(first.candidateIds, []);
        const draft = yield* m.createVersion({
          materialId: root.id,
          content: { kind: 'document', ...deletionDocument('draft') }
        });
        const latest = yield* m.createVersion({
          materialId: root.id,
          content: { kind: 'document', ...deletionDocument('new') },
          publish: true
        });
        assert.equal(
          (yield* Effect.flip(
            m.requestHistoryPrune({
              ...scope,
              operationId: 'stale',
              candidateIds: [],
              token: first.token
            })
          )).kind,
          'invalid_input'
        );
        const preview = yield* m.previewHistoryPrune(scope);
        assert.ok(preview.protected.some((p) => p.versionId === draft.id && p.reason === 'draft'));
        assert.ok(
          preview.protected.some((p) => p.versionId === latest.id && p.reason === 'keep_latest')
        );
        assert.equal(
          (yield* Effect.flip(
            m.requestHistoryPrune({
              ...scope,
              operationId: 'expanded',
              candidateIds: [root.version.id, latest.id],
              token: preview.token
            })
          )).kind,
          'invalid_input'
        );
        const noopScope = { materialId: root.id, policy: { keepLatest: 1000 } };
        const noop = yield* m.previewHistoryPrune(noopScope);
        assert.deepEqual(noop.candidateIds, []);
        return yield* m.requestHistoryPrune({
          ...noopScope,
          operationId: 'noop',
          candidateIds: [],
          token: noop.token
        });
      }).pipe(Effect.provide(f.domain()))
    );
    await cleanup(f, input.operationId);
    assert.equal(
      (
        await Effect.runPromise(
          Effect.gen(function* () {
            return yield* (yield* Materials).historyPrune({ operationId: input.operationId });
          }).pipe(Effect.provide(f.domain()))
        )
      ).status,
      'completed'
    );
  } finally {
    await f.close();
  }
});

test('cleanup failure remains visible, retry advances exactly once and stale settlement cannot complete a newer attempt', async () => {
  const f = await documentTransformFixture();
  try {
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const m = yield* Materials;
        const root = yield* m.create({
          title: 'Retry',
          content: { kind: 'document', ...deletionDocument('retry-old') },
          publish: true
        });
        yield* m.createVersion({
          materialId: root.id,
          content: { kind: 'document', ...deletionDocument('retry-current') },
          publish: true
        });
        const scope = { materialId: root.id, policy: { keepLatest: 1 } };
        const preview = yield* m.previewHistoryPrune(scope);
        const accepted = yield* m.requestHistoryPrune({
          ...scope,
          operationId: 'retry-history',
          candidateIds: preview.candidateIds,
          token: preview.token
        });
        yield* m.failMaterialHistory({
          operationId: accepted.operationId,
          attempt: 1,
          errorKind: 'internal'
        });
        const retried = yield* m.retryHistoryPrune({ operationId: accepted.operationId });
        assert.equal(retried.attempt, 2);
        assert.equal(
          (yield* m.failMaterialHistory({
            operationId: accepted.operationId,
            attempt: 1,
            errorKind: 'internal'
          })).status,
          'pending'
        );
        return { root, accepted };
      }).pipe(Effect.provide(f.domain()))
    );
    const failure = await Effect.runPromise(
      withTestPublication(
        f.context,
        Effect.gen(function* () {
          const m = yield* Materials;
          assert.equal(
            (yield* m.finishMaterialHistory({
              operationId: saved.accepted.operationId,
              attempt: 1
            })).status,
            'pending'
          );
        }).pipe(Effect.provide(f.domain()))
      ).pipe(Effect.provide(f.domain()))
    );
    assert.equal(failure, undefined);
    await assert.rejects(acceptMaterialDeletion(f, saved.root.id));
    await cleanup(f, saved.accepted.operationId);
    await acceptMaterialDeletion(f, saved.root.id);
  } finally {
    await f.close();
  }
});

test('pruned exact input retires private captures and generation while a fresh scope remains usable', async () => {
  const f = await documentTransformFixture();
  try {
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const m = yield* Materials;
        const c = yield* Conversations;
        const root = yield* m.create({
          title: 'Input history',
          content: { kind: 'document', ...deletionDocument('CAPTURE_PAYLOAD_PRUNE') },
          publish: true
        });
        const session = yield* c.createSession({ title: 'Retained session' });
        yield* c.postMessage({
          sessionId: session.id,
          text: 'RETAINED_MESSAGE_COPY',
          requestReply: false
        });
        yield* c.updateSessionSelection({
          sessionId: session.id,
          expectedRevision: 0n,
          targets: [{ versionId: root.version.id, scope: { kind: 'document' } }]
        });
        const captureInput = {
          sessionId: session.id,
          intentKey: 'same-run',
          instruction: 'PRIVATE_CAPTURE_PRUNE',
          preferences: {}
        };
        const capture = yield* c.captureSessionContext(captureInput);
        const generation = yield* c.requestDocumentTransform({
          contextRequestId: capture.requestId,
          title: 'Pending transform',
          operations: ['clarity']
        });
        const current = yield* m.createVersion({
          materialId: root.id,
          content: { kind: 'document', ...deletionDocument('FRESH_INPUT_KEEP') },
          publish: true
        });
        const scope = { materialId: root.id, policy: { keepLatest: 1 } };
        const preview = yield* m.previewHistoryPrune(scope);
        assert.ok(preview.privateRequestIds.includes(capture.requestId));
        yield* m.requestHistoryPrune({
          ...scope,
          operationId: 'capture-prune',
          candidateIds: preview.candidateIds,
          token: preview.token
        });
        assert.equal(
          (yield* Effect.flip(c.sessionContext({ requestId: capture.requestId }))).kind,
          'not_found'
        );
        assert.equal(
          (yield* Effect.flip(m.materialGeneration({ requestId: generation.id, verifyOnly: true })))
            .kind,
          'not_found'
        );
        return { captureInput, capture, generation, session, current };
      }).pipe(Effect.provide(f.domain()))
    );
    await cleanup(f, 'capture-prune');
    await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Conversations;
        assert.equal(
          (yield* Effect.flip(c.captureSessionContext(saved.captureInput))).kind,
          'not_found'
        );
        assert.equal(
          (yield* Effect.flip(
            c.retryDocumentTransform({ requestId: saved.generation.id, retryId: 'same-run-retry' })
          )).kind,
          'not_found'
        );
        const selection = yield* c.sessionSelection({ sessionId: saved.session.id });
        yield* c.updateSessionSelection({
          sessionId: saved.session.id,
          expectedRevision: selection.revision,
          targets: [{ versionId: saved.current.id, scope: { kind: 'document' } }]
        });
        const fresh = yield* c.captureSessionContext({
          ...saved.captureInput,
          intentKey: 'fresh-work'
        });
        assert.equal(fresh.inputs[0]?.versionId, saved.current.id);
      }).pipe(Effect.provide(f.domain()))
    );
    assert.deepEqual(
      f.context.db.orm
        .select()
        .from(s.session_run_contexts)
        .where(eq(s.session_run_contexts.request_id, saved.capture.requestId))
        .all(),
      []
    );
    assert.equal(
      f.context.db.orm
        .select()
        .from(s.material_generation_requests)
        .where(eq(s.material_generation_requests.id, saved.generation.id))
        .get()?.payload,
      '{}'
    );
    assert.equal(
      f.context.db.orm.all(
        sql`SELECT text FROM message_versions WHERE text='RETAINED_MESSAGE_COPY'`
      ).length,
      1
    );
  } finally {
    await f.close();
  }
});

test('history candidate batches are deterministic oldest-first and bounded to one hundred identities', async () => {
  const f = await documentTransformFixture();
  try {
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const m = yield* Materials;
        const root = yield* m.create({
          title: 'Batch',
          content: { kind: 'diagram', format: 'mermaid', payload: 'graph TD; A' },
          publish: true
        });
        const ids = [root.version.id];
        for (let number = 2; number <= 103; number++) {
          const version = yield* m.createVersion({
            materialId: root.id,
            content: { kind: 'diagram', format: 'mermaid', payload: `graph TD; V${number}` },
            publish: true
          });
          ids.push(version.id);
        }
        const scope = { materialId: root.id, policy: { keepLatest: 1 } };
        const preview = yield* m.previewHistoryPrune(scope);
        assert.deepEqual(preview.candidateIds, ids.slice(0, 100));
        assert.equal(preview.hasMore, true);
        assert.equal((yield* m.previewHistoryPrune(scope)).token, preview.token);
        yield* m.requestHistoryPrune({
          ...scope,
          operationId: 'bounded-batch',
          candidateIds: preview.candidateIds,
          token: preview.token
        });
        return { scope, ids };
      }).pipe(Effect.provide(f.domain()))
    );
    await cleanup(f, 'bounded-batch');
    await Effect.runPromise(
      Effect.gen(function* () {
        const m = yield* Materials;
        const next = yield* m.previewHistoryPrune(saved.scope);
        assert.deepEqual(next.candidateIds, saved.ids.slice(100, 102));
        assert.equal(next.hasMore, false);
        assert.equal(
          (yield* m.material({ id: saved.scope.materialId })).version.id,
          saved.ids[102]
        );
      }).pipe(Effect.provide(f.domain()))
    );
  } finally {
    await f.close();
  }
});
