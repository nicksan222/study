/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises editing retained Documents after their evidence is retired.              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves exact inherited provenance through guarded saves, undo and replay.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native RPC and Workflow use migrated SQLite; fixtures own resource lifetime.             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import { documentTransformFixture } from '#testing/document-transform';
import {
  acceptMaterialDeletion,
  cleanupMaterial,
  deletionDocument
} from '#testing/material-deletion';
import { acceptHistory, cleanupHistory } from '#testing/material-history';

for (const kind of ['delete', 'prune'] as const)
  test(`${kind} preserves guarded editing and exact unavailable provenance of kept Documents`, async () => {
    const f = await documentTransformFixture();
    const handlers = () => MaterialsRpcLive.pipe(Layer.provideMerge(f.domain()));
    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
          const body = deletionDocument('Evidence passage');
          const evidence = yield* rpc('materials.createManualDocument', {
            title: 'Evidence',
            document: body
          });
          const documentId = f.context.db.orm
            .select()
            .from(s.material_document_versions)
            .where(eq(s.material_document_versions.version_id, evidence.version.id))
            .get()!.document_id;
          const target = {
            versionId: evidence.version.id,
            documentId,
            blockId: body.blocks[0]!.id,
            start: 0,
            end: 8
          };
          const claim = yield* rpc('materials.create', {
            title: 'Kept',
            content: { kind: 'document', ...deletionDocument('Claim [1]') },
            inputs: [evidence.version.id],
            publish: false
          });
          yield* rpc('materials.setCitations', {
            id: claim.version.id,
            citations: [
              {
                marker: 1n,
                inputVersionId: evidence.version.id,
                anchor: { type: 'authored' },
                target,
                quote: 'Evidence'
              }
            ]
          });
          yield* rpc('materials.publishVersion', { id: claim.version.id });
          if (kind === 'prune')
            yield* rpc('materials.createVersion', {
              materialId: evidence.id,
              content: { kind: 'document', ...deletionDocument('New evidence') },
              publish: true
            });
          return { evidence, claim, target };
        }).pipe(Effect.scoped, Effect.provide(handlers()))
      );
      const operationId = 'retained-edit-prune';
      if (kind === 'delete') await acceptMaterialDeletion(f, setup.evidence.id);
      else await acceptHistory(f, setup.evidence.id, operationId);
      let currentId = setup.claim.version.id;
      for (const phase of ['accepted', 'cleaned'] as const) {
        if (phase === 'cleaned') {
          if (kind === 'delete') await cleanupMaterial(f, setup.evidence.id);
          else await cleanupHistory(f, operationId);
          f.reopen();
        }
        currentId = await Effect.runPromise(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
            const input = {
              materialId: setup.claim.id,
              expectedVersionId: currentId,
              saveKey: `save-${phase}`,
              document: deletionDocument(`Edited ${phase} [1]`)
            };
            const saved = yield* rpc('materials.saveDocument', input);
            assert.equal(saved.outcome, 'saved');
            assert.deepEqual(yield* rpc('materials.saveDocument', input), {
              ...saved,
              replayed: true
            });
            const conflict = yield* rpc('materials.saveDocument', {
              ...input,
              saveKey: `conflict-${phase}`
            });
            assert.equal(conflict.outcome, 'conflict');
            const undo = yield* rpc('materials.undoDocument', {
              materialId: setup.claim.id,
              expectedVersionId: saved.submittedVersionId,
              restoreVersionId: setup.claim.version.id,
              undoKey: `undo-${phase}`
            });
            assert.equal(undo.outcome, 'saved');
            for (const id of [
              saved.submittedVersionId,
              undo.submittedVersionId,
              conflict.submittedVersionId
            ]) {
              const version = yield* rpc('materials.materialVersion', { id });
              assert.deepEqual(version.inputs, [setup.evidence.version.id]);
              const { items: citations } = yield* rpc('materials.citations', { id, limit: 10 });
              assert.equal(citations.length, 1);
              assert.deepEqual(citations[0]!.target, setup.target);
              assert.equal(citations[0]!.inputVersionId, setup.evidence.version.id);
              assert.equal(citations[0]!.quote, 'Evidence');
              assert.equal(citations[0]!.evidence?.availability, 'unavailable');
            }
            assert.equal(
              (yield* Effect.flip(
                rpc('materials.materialVersion', { id: setup.evidence.version.id })
              )).kind,
              'not_found'
            );
            assert.equal(
              (yield* Effect.flip(
                rpc('materials.create', {
                  title: 'New forbidden use',
                  content: { kind: 'document', ...deletionDocument('New claim') },
                  inputs: [setup.evidence.version.id],
                  publish: true
                })
              )).kind,
              'not_found'
            );
            if (kind === 'prune')
              assert.equal(
                (yield* Effect.flip(
                  rpc('materials.undoDocument', {
                    materialId: setup.evidence.id,
                    expectedVersionId: (yield* rpc('materials.material', { id: setup.evidence.id }))
                      .version.id,
                    restoreVersionId: setup.evidence.version.id,
                    undoKey: `forbidden-${phase}`
                  })
                )).kind,
                'not_found'
              );
            return undo.submittedVersionId;
          }).pipe(Effect.scoped, Effect.provide(handlers()))
        );
      }
    } finally {
      await f.close();
    }
  });
