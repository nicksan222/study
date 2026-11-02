/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises managed-image acquisition across accepted Material deletion.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Rejects new owners while retaining previously published image copies.                  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Public RPC and native cleanup use migrated SQLite; fixtures own resource lifetime.       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MaterialsRpc } from '@study/contracts/materials/rpc';
import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';

import { Materials } from '#server/features/materials/index';
import { MaterialsRpcLive } from '#server/features/materials/rpc/index';
import { Sources } from '#server/features/sources/index';
import { documentTransformFixture } from '#testing/document-transform';
import {
  acceptMaterialDeletion,
  cleanupMaterial,
  deletionDocument
} from '#testing/material-deletion';
import { assertSourceGone } from '#testing/material-deletion-sources';

for (const owner of ['none', 'draft', 'published'] as const)
  test(`deleted image rejects new acquisitions with ${owner} pre-existing owner`, async () => {
    const f = await documentTransformFixture();
    const handlers = () => MaterialsRpcLive.pipe(Layer.provideMerge(f.domain()));

    try {
      const setup = await Effect.runPromise(
        Effect.gen(function* () {
          const source = yield* (yield* Sources).createSource({
            projectId: null,
            name: 'private.png',
            bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
          });
          const original = (yield* (yield* Materials).materials({
            archived: false,
            limit: 20
          })).items.find((item) => item.importProcessing?.sourceId === source.id)!;

          assert.ok(original);
          const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
          const document = () => ({
            ...deletionDocument('Caption'),
            blocks: [
              createBlock({
                type: 'image',
                sourceId: source.id,
                revision: 1,
                alt: 'Private image'
              })
            ]
          });
          const copy =
            owner === 'none'
              ? null
              : yield* rpc('materials.create', {
                  title: 'Existing owner',
                  content: { kind: 'document', ...document() },
                  publish: owner === 'published'
                });

          return { source, original, copy, document };
        }).pipe(Effect.scoped, Effect.provide(handlers()))
      );

      await acceptMaterialDeletion(f, setup.original.id);
      const assertBlocked = () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
            const count = f.context.db.orm.select().from(s.document_assets).all().length;

            assert.equal(
              (yield* Effect.flip(
                rpc('materials.createManualDocument', {
                  title: 'Forbidden owner',
                  document: setup.document()
                })
              )).kind,
              'invalid_input'
            );
            assert.equal(
              (yield* Effect.flip(
                rpc('materials.create', {
                  title: 'Forbidden draft',
                  content: { kind: 'document', ...setup.document() },
                  publish: false
                })
              )).kind,
              'invalid_input'
            );
            assert.equal(f.context.db.orm.select().from(s.document_assets).all().length, count);

            if (owner === 'draft' && setup.copy) {
              assert.equal(
                (yield* Effect.flip(rpc('materials.publishVersion', { id: setup.copy.version.id })))
                  .kind,
                'invalid_input'
              );
              assert.throws(() =>
                f.context.db.orm.run(
                  sql`UPDATE material_versions SET status='published',published_at=1 WHERE id=${setup.copy!.version.id}`
                )
              );
            }

            assert.equal(
              (yield* Effect.flip(
                rpc('materials.materialVersionExport', { id: setup.original.version.id })
              )).kind,
              'not_found'
            );
          }).pipe(Effect.scoped, Effect.provide(handlers()))
        );

      await assertBlocked();
      f.context.db.orm.run(
        sql`CREATE TRIGGER fail_image_cleanup BEFORE DELETE ON source_blobs BEGIN SELECT RAISE(ABORT,'injected'); END`
      );
      await assert.rejects(cleanupMaterial(f, setup.original.id));
      f.reopen();
      await assertBlocked();
      f.context.db.orm.run(sql`DROP TRIGGER fail_image_cleanup`);
      await Effect.runPromise(
        Effect.flatMap(Materials, (m) => m.retryDeletion({ materialId: setup.original.id })).pipe(
          Effect.provide(f.domain())
        )
      );
      await cleanupMaterial(f, setup.original.id);
      f.reopen();
      await assertBlocked();

      if (owner === 'none') assertSourceGone(f, setup.source.id);

      if (owner === 'published' && setup.copy) {
        await Effect.runPromise(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
            const saved = yield* rpc('materials.saveDocument', {
              materialId: setup.copy!.id,
              expectedVersionId: setup.copy!.version.id,
              saveKey: 'retained-image',
              document: setup.document()
            });

            assert.equal(saved.outcome, 'saved');
            assert.equal(
              (yield* rpc('materials.materialVersion', { id: saved.submittedVersionId })).content
                .kind,
              'document'
            );
            assert.equal(
              f.context.db.orm
                .select()
                .from(s.source_snapshots)
                .where(eq(s.source_snapshots.source_id, setup.source.id))
                .all().length,
              1
            );
          }).pipe(Effect.scoped, Effect.provide(handlers()))
        );
      }
    } finally {
      await f.close();
    }
  });

test('retained image draft replacements validate submitted ownership before writing content', async () => {
  const f = await documentTransformFixture();
  const handlers = () => MaterialsRpcLive.pipe(Layer.provideMerge(f.domain()));

  try {
    const setup = await Effect.runPromise(
      Effect.gen(function* () {
        const source = yield* (yield* Sources).createSource({
          projectId: null,
          name: 'retained.png',
          bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
        });
        const original = (yield* (yield* Materials).materials({
          archived: false,
          limit: 20
        })).items.find((item) => item.importProcessing?.sourceId === source.id)!;

        assert.ok(original);
        const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
        const image = () =>
          createBlock({ type: 'image', sourceId: source.id, revision: 1, alt: 'Kept' });
        const body = () => ({ ...deletionDocument('Caption'), blocks: [image()] });
        const owner = yield* rpc('materials.createManualDocument', {
          title: 'Owner',
          document: body()
        });
        const unrelated = yield* rpc('materials.createManualDocument', {
          title: 'Unrelated',
          document: deletionDocument('Other')
        });
        const draft = yield* rpc('materials.create', {
          title: 'Draft',
          content: { kind: 'document', ...body() },
          inputs: [owner.version.id],
          publish: false
        });

        return { source, original, owner, unrelated, draft, body };
      }).pipe(Effect.scoped, Effect.provide(handlers()))
    );

    await acceptMaterialDeletion(f, setup.original.id);

    for (const phase of ['accepted', 'cleaned'] as const) {
      if (phase === 'cleaned') {
        await cleanupMaterial(f, setup.original.id);
        f.reopen();
      }

      await Effect.runPromise(
        Effect.gen(function* () {
          const rpc = yield* RpcTest.makeClient(MaterialsRpc, { flatten: true });
          const content = { kind: 'document' as const, ...setup.body() };
          const replacement = yield* rpc('materials.replaceDraft', {
            id: setup.draft.version.id,
            content,
            inputs: [setup.owner.version.id]
          });

          assert.equal(replacement.content.kind, 'document');
          assert.deepEqual(replacement.inputs, [setup.owner.version.id]);

          for (const inputs of [[], [setup.unrelated.version.id], [setup.original.version.id]]) {
            const rejected = yield* Effect.flip(
              rpc('materials.replaceDraft', { id: setup.draft.version.id, content, inputs })
            );

            assert.equal(
              rejected.kind,
              inputs[0] === setup.original.version.id ? 'not_found' : 'invalid_input'
            );
            assert.deepEqual(
              yield* rpc('materials.materialVersion', { id: setup.draft.version.id }),
              replacement
            );
          }
          // Source-owned Documents remain fenced; source-less creation and replacement above are admitted.

          assert.throws(() =>
            f.context.db.orm.run(
              sql`INSERT INTO documents(source_id,extractor,extractor_version,meta,created_at) VALUES(${setup.source.id},'text',1,'{}',1)`
            )
          );

          if (phase === 'accepted')
            assert.throws(() =>
              f.context.db.orm.run(
                sql`UPDATE source_processing SET revision=revision+1 WHERE source_id=${setup.source.id}`
              )
            );

          if (phase === 'cleaned') {
            yield* rpc('materials.publishVersion', { id: setup.draft.version.id });
            const retained = yield* rpc('materials.materialVersion', {
              id: setup.draft.version.id
            });

            assert.equal(retained.status, 'published');
            assert.equal(
              f.context.db.orm
                .select()
                .from(s.source_snapshots)
                .where(eq(s.source_snapshots.source_id, setup.source.id))
                .all().length,
              1
            );
          }
        }).pipe(Effect.scoped, Effect.provide(handlers()))
      );
    }
  } finally {
    await f.close();
  }
});
