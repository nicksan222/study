/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises authored Page image retention behavior through real persistence          │
 * │ boundaries.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies authored images retain exact source bytes through replacement, unrelated      │
 * │   draft cleanup and project deletion.                                                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { createBlock } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

testStable(
  'authored images retain exact source bytes through replacement, unrelated draft cleanup and project deletion',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const layer = Layer.mergeAll(Pages.layer, Materials.layer, Sources.layer, Projects.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const sources = yield* Sources;
          const materials = yield* Materials;
          const projects = yield* Projects;
          const project = yield* projects.createProject({ name: 'Images' });
          const other = yield* projects.createProject({ name: 'Other' });
          const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
          const source = yield* sources.createSource({
            projectId: project.id,
            name: 'image.png',
            bytes
          });
          const document = {
            blocks: [
              createBlock({ type: 'image', sourceId: source.id, revision: 1, alt: 'Retained' })
            ],
            meta: {
              extractor: null,
              extractorVersion: 1,
              provider: null,
              durationMs: null,
              pageCount: null,
              refiners: [],
              waitingFor: [],
              corrected: false,
              omissions: []
            }
          };
          const image = yield* docs.create({
            createKey: crypto.randomUUID(),
            title: 'Image',
            projectId: project.id,
            document,
            inputs: [],
            citations: []
          });

          assert.ok(image.version);
          const content = {
            kind: 'flashcards' as const,
            cards: [{ front: 'A', back: 'B' }]
          };
          const learning = yield* materials.create({
            projectId: project.id,
            title: 'Independent',
            content
          });
          const draft = yield* materials.createVersion({
            materialId: learning.id,
            content,
            publish: false
          });

          yield* materials.deleteDraft({ id: draft.id });
          assert.strictEqual(
            context.db.orm.get(
              sql`SELECT count(*) n FROM document_assets WHERE source_id=${source.id}`
            )?.n,
            1n
          );
          const before = context.db.orm.all(sql`SELECT * FROM source_snapshots`);
          const events = context.db.orm.all(sql`SELECT * FROM workflow_events`).length;

          context.db.exec(
            "CREATE TRIGGER reject_image_replacement BEFORE INSERT ON workflow_events WHEN NEW.type='SourceProcessingRequested' BEGIN SELECT RAISE(ABORT,'injected replacement failure'); END"
          );
          yield* Effect.flip(
            sources.replaceSource({
              id: source.id,
              expectedRevision: 1,
              name: 'new.png',
              bytes: new Uint8Array([1, 2, 3])
            })
          );
          expect(context.db.orm.all(sql`SELECT * FROM source_snapshots`)).toStrictEqual(before);
          assert.strictEqual(context.db.orm.all(sql`SELECT * FROM workflow_events`).length, events);
          assert.strictEqual((yield* sources.sourceProcessing(source.id)).revision, 1);
          context.db.exec('DROP TRIGGER reject_image_replacement');
          yield* sources.replaceSource({
            id: source.id,
            expectedRevision: 1,
            name: 'new.png',
            bytes: new Uint8Array([1, 2, 3])
          });
          expect(
            (yield* sources.exportRevision({ sourceId: source.id, revision: 1n })).bytes
          ).toStrictEqual(bytes);
          expect((yield* docs.version({ id: image.version.id })).document).toStrictEqual(document);

          for (const query of [
            sql`UPDATE source_snapshots SET bytes=X'00' WHERE source_id=${source.id} AND revision=1`,
            sql`UPDATE source_snapshots SET mime='text/plain' WHERE source_id=${source.id} AND revision=1`,
            sql`DELETE FROM source_snapshots WHERE source_id=${source.id} AND revision=1`
          ])
            assert.throws(() => context.db.orm.run(query));

          yield* sources.setSourceProject({ id: source.id, projectId: other.id });
          yield* projects.deleteProject({ id: project.id });
          expect((yield* docs.version({ id: image.version.id })).document).toStrictEqual(document);
          assert.ok(
            (yield* sources.previewDeletion({ id: source.id })).blockedBy.includes('image_assets')
          );
          const preview = yield* docs.previewDeletion({ id: image.id });

          yield* docs.delete({ pageId: image.id, token: preview.token });
          expect((yield* sources.previewDeletion({ id: source.id })).blockedBy).toStrictEqual([]);
          assert.strictEqual(yield* sources.deleteSource({ id: source.id }), true);
          assert.strictEqual(
            context.db.orm.get(sql`SELECT 1 FROM source_snapshots WHERE source_id=${source.id}`),
            undefined
          );
          expect(context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
