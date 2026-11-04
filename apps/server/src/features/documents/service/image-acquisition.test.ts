/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Source deletion and authored image acquisition use exact original byte revisions   │
 * │ and immutable alternatives.                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies image saves validate the submitted exact image revision and retained editing  │
 * │   identity before any write.                                                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { sourceIdSchema } from '@study/contracts/ids';
import { createBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/node';
import { Effect, Schema } from 'effect';

import { Documents } from '#server/features/documents/index';
import { Sources } from '#server/features/sources/index';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';

const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

for (const owner of ['none', 'draft', 'published'] as const)
  testStable(
    `image source deletion respects ${owner} authored ownership and rejects every acquisition after final release`,
    async () => {
      const f = await documentTransformFixture();

      try {
        const saved = await Effect.runPromise(
          Effect.gen(function* () {
            const sources = yield* Sources;
            const docs = yield* Documents;
            const source = yield* sources.createSource({
              projectId: null,
              name: 'private.png',
              bytes
            });
            const image = () => ({
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
            const create = () =>
              docs.create({
                createKey: randomUUID(),
                title: 'Owner',
                document: image(),
                inputs: [],
                citations: []
              });
            const original =
              owner === 'none'
                ? null
                : yield* docs.create({
                    createKey: randomUUID(),
                    title: 'Existing owner',
                    document: owner === 'draft' ? deletionDocument('Initial') : image(),
                    inputs: [],
                    citations: []
                  });

            if (original) assert.ok(original.version);

            let draftId = null;

            if (owner === 'draft' && original?.version) {
              yield* docs.save({
                documentId: original.id,
                expectedVersionId: original.version.id,
                key: 'advance',
                document: deletionDocument('Current')
              });
              const alternative = yield* docs.save({
                documentId: original.id,
                expectedVersionId: original.version.id,
                key: 'image-conflict',
                document: image()
              });

              assert.equal(alternative.outcome, 'conflict');
              draftId = alternative.submittedVersionId;
            }

            const preview = yield* sources.previewDeletion({ id: source.id });

            if (owner === 'none') assert.deepEqual(preview.blockedBy, []);
            else {
              assert.ok(preview.blockedBy.includes('image_assets'));
              assert.equal(
                (yield* Effect.flip(sources.deleteSource({ id: source.id }))).kind,
                'invalid_input'
              );
              const independent = yield* create();

              assert.ok(independent.version);
              const originalPreview = yield* docs.previewDeletion({ id: original!.id });

              yield* docs.delete({ documentId: original!.id, token: originalPreview.token });
              assert.ok(
                (yield* sources.previewDeletion({ id: source.id })).blockedBy.includes(
                  'image_assets'
                )
              );
              assert.deepEqual(
                (yield* sources.exportRevision({ sourceId: source.id, revision: 1n })).bytes,
                bytes
              );
              const independentPreview = yield* docs.previewDeletion({ id: independent.id });

              yield* docs.delete({ documentId: independent.id, token: independentPreview.token });

              if (draftId)
                assert.equal((yield* Effect.flip(docs.version({ id: draftId }))).kind, 'not_found');
            }

            yield* sources.deleteSource({ id: source.id });

            return { source, image };
          }).pipe(Effect.provide(f.domain()))
        );

        f.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;
            const sources = yield* Sources;

            assert.equal(
              (yield* Effect.flip(
                docs.create({
                  createKey: randomUUID(),
                  title: 'Forbidden acquisition',
                  document: saved.image(),
                  inputs: [],
                  citations: []
                })
              )).kind,
              'invalid_input'
            );
            assert.equal(
              (yield* Effect.flip(
                sources.exportRevision({ sourceId: saved.source.id, revision: 1n })
              )).kind,
              'not_found'
            );
          }).pipe(Effect.provide(f.domain()))
        );
        assert.equal(f.context.db.orm.get(sql`SELECT count(*) n FROM document_assets`)?.n, 0n);
        assert.equal(
          f.context.db.orm.get(
            sql`SELECT count(*) n FROM source_snapshots WHERE source_id=${saved.source.id}`
          )?.n,
          0n
        );
        assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
      } finally {
        await f.close();
      }
    }
  );

testStable(
  'image saves validate the submitted exact image revision and retained editing identity before any write',
  async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const docs = yield* Documents;
          const source = yield* sources.createSource({
            projectId: null,
            name: 'retained.png',
            bytes
          });
          const image = createBlock({
            type: 'image',
            sourceId: source.id,
            revision: 1,
            alt: 'Kept'
          });
          const body = { ...deletionDocument('Caption'), blocks: [image] };
          const document = yield* docs.create({
            createKey: randomUUID(),
            title: 'Owner',
            document: body,
            inputs: [],
            citations: []
          });

          assert.ok(document.version);
          const unrelated = yield* docs.create({
            createKey: randomUUID(),
            title: 'Unrelated',
            document: deletionDocument('Other'),
            inputs: [],
            citations: []
          });

          assert.ok(unrelated.version);

          return {
            source,
            body,
            document: { ...document, version: document.version },
            unrelated: unrelated.version
          };
        }).pipe(Effect.provide(f.domain()))
      );

      f.reopen();
      const before = {
        assets: f.context.db.orm.select().from(s.document_assets).all(),
        versions: f.context.db.orm.select().from(s.study_document_versions).all(),
        blocks: f.context.db.orm.select().from(s.blocks).all()
      };

      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Documents;

          for (const content of [
            {
              type: 'image' as const,
              sourceId: Schema.decodeUnknownSync(sourceIdSchema)(saved.source.id + 999n),
              revision: 1,
              alt: 'Fake source'
            },
            {
              type: 'image' as const,
              sourceId: saved.source.id,
              revision: 999,
              alt: 'Fake revision'
            }
          ])
            assert.equal(
              (yield* Effect.flip(
                docs.save({
                  documentId: saved.document.id,
                  expectedVersionId: saved.document.version.id,
                  key: randomUUID(),
                  document: { ...saved.body, blocks: [createBlock(content)] }
                })
              )).kind,
              'invalid_input'
            );

          assert.equal(
            (yield* Effect.flip(
              docs.save({
                documentId: saved.document.id,
                expectedVersionId: saved.document.version.id,
                key: 'foreign-identities',
                document: { ...saved.body, blocks: [saved.unrelated.document.blocks[0]!] }
              })
            )).kind,
            'invalid_input'
          );
        }).pipe(Effect.provide(f.domain()))
      );
      assert.deepEqual(
        {
          assets: f.context.db.orm.select().from(s.document_assets).all(),
          versions: f.context.db.orm.select().from(s.study_document_versions).all(),
          blocks: f.context.db.orm.select().from(s.blocks).all()
        },
        before
      );
      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      await f.close();
    }
  }
);
