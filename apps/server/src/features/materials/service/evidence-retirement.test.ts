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

import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';
import { acceptHistory, cleanupHistory } from '#testing/material-history';

test('prune acceptance filters each annotation revision before list and history pagination', async () => {
  const f = await documentTransformFixture();
  const handlers = () => MaterialsRpcLive.pipe(Layer.provideMerge(f.domain()));

  try {
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
        const body = deletionDocument('Retained annotated content');
        const material = yield* rpc('materials.createManualDocument', {
          title: 'Annotations',
          document: body
        });
        const oldTarget = {
          materialId: material.id,
          range: {
            versionId: material.version.id,
            documentId: f.context.db.orm
              .select()
              .from(s.material_document_versions)
              .where(eq(s.material_document_versions.version_id, material.version.id))
              .get()!.document_id,
            blockId: body.blocks[0]!.id,
            start: 0,
            end: 8
          }
        };
        const hidden = yield* rpc('materials.createAnnotation', {
          target: oldTarget,
          kind: 'note',
          note: 'PRUNED_CURRENT_NOTE'
        });
        const moved = yield* rpc('materials.createAnnotation', {
          target: oldTarget,
          kind: 'note',
          note: 'PRUNED_OLD_NOTE'
        });

        assert.equal(hidden.outcome, 'saved');
        assert.equal(moved.outcome, 'saved');
        const updated = yield* rpc('materials.updateAnnotation', {
          id: moved.annotation.id,
          expectedRevision: 1n,
          kind: 'note',
          note: 'Retained note'
        });

        assert.equal(updated.outcome, 'saved');
        const current = yield* rpc('materials.saveDocument', {
          materialId: material.id,
          expectedVersionId: material.version.id,
          saveKey: 'new-head',
          document: body
        });

        assert.equal(current.outcome, 'saved');
        const target = {
          ...oldTarget,
          range: {
            ...oldTarget.range,
            versionId: current.submittedVersionId,
            documentId: f.context.db.orm
              .select()
              .from(s.material_document_versions)
              .where(eq(s.material_document_versions.version_id, current.submittedVersionId))
              .get()!.document_id
          }
        };
        const reanchored = yield* rpc('materials.reanchorAnnotation', {
          id: moved.annotation.id,
          expectedRevision: 2n,
          target
        });

        assert.equal(reanchored.outcome, 'saved');
        const sibling = yield* rpc('materials.createAnnotation', {
          target,
          kind: 'note',
          note: 'Sibling note'
        });

        assert.equal(sibling.outcome, 'saved');

        return {
          materialId: material.id,
          hidden: hidden.annotation.id,
          moved: moved.annotation.id,
          sibling: sibling.annotation.id
        };
      }).pipe(Effect.scoped, Effect.provide(handlers()))
    );

    const assertVisible = () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });

          assert.equal(
            (yield* Effect.flip(rpc('materials.annotation', { id: saved.hidden }))).kind,
            'not_found'
          );
          const page = yield* rpc('materials.annotations', {
            materialId: saved.materialId,
            limit: 1
          });

          assert.deepEqual(
            page.items.map((item) => item.id),
            [saved.moved]
          );
          assert.equal(page.nextCursor, saved.moved);
          const next = yield* rpc('materials.annotations', {
            materialId: saved.materialId,
            limit: 1,
            cursor: page.nextCursor!
          });

          assert.deepEqual(
            next.items.map((item) => item.id),
            [saved.sibling]
          );
          assert.equal(next.nextCursor, null);
          const history = yield* rpc('materials.annotationHistory', { id: saved.moved, limit: 1 });

          assert.deepEqual(
            history.items.map((item) => [item.revision, item.note]),
            [[3n, 'Retained note']]
          );
          assert.equal(history.nextCursor, null);
        }).pipe(Effect.scoped, Effect.provide(handlers()))
      );

    const operationId = 'annotation-prune';

    await acceptHistory(f, saved.materialId, operationId);
    await assertVisible();
    f.context.db.orm.run(
      sql`CREATE TRIGGER reject_annotation_cleanup BEFORE DELETE ON blocks BEGIN SELECT RAISE(ABORT, 'injected'); END`
    );
    await assert.rejects(cleanupHistory(f, operationId));
    await assertVisible();
    f.reopen();
    await assertVisible();
    f.context.db.orm.run(sql`DROP TRIGGER reject_annotation_cleanup`);
    await Effect.runPromise(
      Effect.flatMap(Materials, (m) => m.retryHistoryPrune({ operationId })).pipe(
        Effect.provide(f.domain())
      )
    );
    await cleanupHistory(f, operationId);
    f.reopen();
    await assertVisible();
  } finally {
    await f.close();
  }
});
