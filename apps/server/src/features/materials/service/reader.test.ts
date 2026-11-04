/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises exact version-owned reader resources through native RPC.                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Covers Document identity, managed image revisions and canonical import lookup.         │
 * │ - Checks ownership and retained-resource behavior across database reopen.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Temporary SQLite fixtures use production services without providers or workers.          │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { createBlock } from '@study/contracts/sources/document';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/node';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Materials } from '#server/features/materials/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';
import { acceptHistory, cleanupHistory } from '#testing/material-history';
import { materialRpcHandlers } from '#testing/material-rpc';

testStable(
  'reader resolves exact authored Documents, managed image revisions and imported identities across reopen',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const handlers = () =>
      materialRpcHandlers.pipe(
        Layer.provideMerge(
          Layer.mergeAll(Materials.layer, Sources.layer).pipe(
            Layer.provideMerge(Layer.succeed(Database, { store: context }))
          )
        )
      );

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
            const sources = yield* Sources;
            const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
            const source = yield* sources.createSource({
              projectId: null,
              name: 'retained.png',
              bytes
            });
            const imported = yield* rpc('materials.importedMaterial', { sourceId: source.id });

            assert.equal(imported.importProcessing?.sourceId, source.id);
            const sameName = yield* sources.createSource({
              projectId: null,
              name: 'retained.png',
              bytes: new Uint8Array([...bytes, 1])
            });
            const otherImport = yield* rpc('materials.importedMaterial', { sourceId: sameName.id });

            assert.notEqual(otherImport.id, imported.id);
            assert.equal(otherImport.importProcessing?.sourceId, sameName.id);
            assert.equal(
              (yield* rpc('materials.importedMaterial', { sourceId: source.id })).id,
              imported.id
            );
            const block = createBlock({
              type: 'image',
              sourceId: source.id,
              revision: 1,
              alt: 'Retained'
            });
            const paragraph = createBlock({ type: 'paragraph', inlines: [] });
            const document = { ...deletionDocument('Reader'), blocks: [block, paragraph] };
            const material = yield* rpc('materials.createManualDocument', {
              title: 'Reader',
              document
            });
            const original = yield* rpc('materials.materialVersionDocument', {
              id: material.version.id
            });

            assert.deepEqual(original.document, document);
            const other = yield* rpc('materials.createManualDocument', {
              title: 'Other',
              document: deletionDocument('Other')
            });
            const otherDocument = yield* rpc('materials.materialVersionDocument', {
              id: other.version.id
            });

            assert.notEqual(original.id, otherDocument.id);
            const key = { id: material.version.id, documentId: original.id, blockId: block.id };
            const image = yield* rpc('materials.materialVersionImage', key);

            assert.deepEqual(image, { sourceId: source.id, revision: 1, mime: 'image/png', bytes });
            assert.equal(
              (yield* Effect.flip(
                rpc('materials.materialVersionImage', {
                  ...key,
                  documentId: otherDocument.id
                })
              )).kind,
              'not_found'
            );
            assert.equal(
              (yield* Effect.flip(
                rpc('materials.materialVersionImage', {
                  ...key,
                  blockId: paragraph.id
                })
              )).kind,
              'not_found'
            );
            yield* sources.replaceSource({
              id: source.id,
              expectedRevision: 1,
              name: 'current.txt',
              bytes: new TextEncoder().encode('Current source bytes are unrelated')
            });
            assert.deepEqual(yield* rpc('materials.materialVersionImage', key), image);
            const revision = yield* rpc('materials.createVersion', {
              materialId: material.id,
              content: { kind: 'document', ...document },
              publish: true
            });
            const revisedDocument = yield* rpc('materials.materialVersionDocument', {
              id: revision.id
            });

            assert.notEqual(revisedDocument.id, original.id);
            assert.equal(
              (yield* Effect.flip(
                rpc('materials.materialVersionImage', {
                  ...key,
                  id: revision.id
                })
              )).kind,
              'not_found'
            );
            assert.deepEqual(
              yield* rpc('materials.materialVersionDocument', { id: material.version.id }),
              original
            );

            return { key, image, original, importedId: imported.id, sourceId: source.id };
          }).pipe(Effect.provide(handlers()))
        )
      );

      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });

            assert.deepEqual(yield* rpc('materials.materialVersionImage', saved.key), saved.image);
            assert.deepEqual(
              yield* rpc('materials.materialVersionDocument', { id: saved.key.id }),
              saved.original
            );
            assert.equal(
              (yield* rpc('materials.importedMaterial', { sourceId: saved.sourceId })).id,
              saved.importedId
            );
          }).pipe(Effect.provide(handlers()))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'accepted history prune fences exact reader versions while another published owner retains image bytes',
  async () => {
    const f = await documentTransformFixture();
    const handlers = () => materialRpcHandlers.pipe(Layer.provideMerge(f.domain()));

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
            const source = yield* (yield* Sources).createSource({
              projectId: null,
              name: 'history.png',
              bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
            });
            const block = createBlock({
              type: 'image',
              sourceId: source.id,
              revision: 1,
              alt: 'History'
            });
            const document = { ...deletionDocument('History'), blocks: [block] };
            const material = yield* rpc('materials.createManualDocument', {
              title: 'History reader',
              document
            });
            const before = yield* rpc('materials.materialVersionDocument', {
              id: material.version.id
            });
            const next = yield* rpc('materials.createVersion', {
              materialId: material.id,
              content: { kind: 'document', ...document },
              publish: true
            });
            const after = yield* rpc('materials.materialVersionDocument', { id: next.id });

            return {
              material,
              before: { id: material.version.id, documentId: before.id, blockId: block.id },
              after: { id: next.id, documentId: after.id, blockId: block.id }
            };
          }).pipe(Effect.provide(handlers()))
        )
      );

      await acceptHistory(f, saved.material.id, 'reader-history');
      const assertRetained = () =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });

              assert.equal(
                (yield* Effect.flip(
                  rpc('materials.materialVersionDocument', { id: saved.before.id })
                )).kind,
                'not_found'
              );
              assert.equal(
                (yield* Effect.flip(rpc('materials.materialVersionImage', saved.before))).kind,
                'not_found'
              );
              assert.equal((yield* rpc('materials.materialVersionImage', saved.after)).revision, 1);
            }).pipe(Effect.provide(handlers()))
          )
        );

      await assertRetained();
      await cleanupHistory(f, 'reader-history');
      f.reopen();
      await assertRetained();
    } finally {
      await f.close();
    }
  }
);
