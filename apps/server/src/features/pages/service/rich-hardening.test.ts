import { materialGenerationPayloadSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Canonical authored bodies keep empty-evidence, receipt-draft and managed asset     │
 * │ boundaries strict.                                                                       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies a retained separator-only learning request cannot retry after reopen or emit  │
 * │   new work.                                                                              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { createBlock, encodeBlockContent } from '@study/contracts';
import { sql } from '@study/db';
import * as s from '@study/db';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import { Materials } from '#server/features/materials/index';
import { Pages } from '#server/features/pages/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import { pageTransformFixture } from '#testing/page-transform';

const meta = {
  extractor: null,
  extractorVersion: 1,
  provider: null,
  durationMs: null,
  pageCount: null,
  refiners: [],
  waitingFor: [],
  corrected: false,
  omissions: []
};

const paragraph = (text: string) =>
  createBlock({ type: 'paragraph', inlines: [{ type: 'text', text, marks: [] }] });

test.stable(
  'a retained separator-only learning request cannot retry after reopen or emit new work',
  async ({ databases }) => {
    const f = await pageTransformFixture(databases);

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const project = yield* (yield* Projects).createProject({ name: 'Historical request' });
          const empty = yield* docs.create({
            createKey: crypto.randomUUID(),
            projectId: project.id,
            title: 'Empty cells',
            document: {
              meta,
              blocks: [
                createBlock({
                  type: 'table',
                  rows: [
                    {
                      cells: [
                        { header: false, paragraphs: [[]] },
                        { header: false, paragraphs: [[]] }
                      ]
                    }
                  ]
                })
              ]
            },
            inputs: [],
            citations: []
          });

          test.assert.ok(empty.version);

          return { project, version: empty.version };
        }).pipe(Effect.provide(f.domain()))
      );
      const payload = Schema.encodeSync(
        Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema))
      )({
        title: 'Previously accepted empty table',
        kind: 'flashcards',
        inputs: [{ kind: 'page', versionId: saved.version.id }]
      });
      // Model a durable request admitted by the earlier textual-content predicate. Guards stay on.

      f.context.transaction(['pages'], (tx) => {
        tx.db.orm
          .insert(s.material_generation_requests)
          .values({ id: 'historical-empty', project_id: saved.project.id, payload, created_at: 1n })
          .run();
        tx.db.orm
          .insert(s.material_evidence_inputs)
          .values({
            request_id: 'historical-empty',
            position: 0n,
            page_version_id: saved.version.id
          })
          .run();
      });
      await f.reopen();
      const before = f.context.db.orm.select().from(s.workflowEvents).all();

      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials;

          test.assert.ok(
            (yield* Effect.flip(
              materials.retryMaterialGenerationOnce({
                requestId: 'historical-empty',
                retryId: 'must-not-publish'
              })
            )).kind === 'invalid_input'
          );
          test.assert.ok(
            (yield* materials.materialGeneration({
              requestId: 'historical-empty',
              verifyOnly: true
            })).resultVersionId === null
          );
          test.assert.ok(
            (yield* (yield* Pages).version({ id: saved.version.id })).status === 'published'
          );
        }).pipe(Effect.provide(f.domain()))
      );
      test.expect(f.context.db.orm.select().from(s.workflowEvents).all()).toStrictEqual(before);
      test.assert.strictEqual(
        f.context.db.orm.select().from(s.material_evidence_inputs).all().length,
        1
      );
      test.expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
    } finally {
      await f.close();
    }
  }
);

test.stable(
  'invalid rich input rolls back and retained conflict drafts reject canonical projection and payload corruption after reopen',
  async ({ databases }) => {
    const f = await pageTransformFixture(databases);

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;
          const block = paragraph('Evidence');

          test.assert.ok(
            (yield* Effect.flip(
              docs.create({
                createKey: crypto.randomUUID(),
                title: 'Invalid',
                document: { blocks: [{ ...block, kind: 'heading' }], meta },
                inputs: [],
                citations: []
              })
            )).kind === 'invalid_input'
          );
          test.assert.strictEqual(f.context.db.orm.select().from(s.pages).all().length, 0);
          test.assert.strictEqual(
            f.context.db.orm.select().from(s.content_snapshots).all().length,
            0
          );
          const original = yield* docs.create({
            createKey: crypto.randomUUID(),
            title: 'Draft alternatives',
            document: { blocks: [block], meta },
            inputs: [],
            citations: []
          });

          test.assert.ok(original.version);
          yield* docs.save({
            pageId: original.id,
            expectedVersionId: original.version.id,
            key: 'first-save',
            document: { blocks: [paragraph('Current')], meta }
          });
          const intent = {
            pageId: original.id,
            expectedVersionId: original.version.id,
            key: 'racing-save',
            document: { blocks: [paragraph('Retained alternative')], meta }
          };
          const conflict = yield* docs.save(intent);

          test.assert.ok(conflict.outcome === 'conflict');
          const draft = yield* docs.version({ id: conflict.submittedVersionId });

          test.assert.ok(draft.status === 'draft');

          return { draft, intent, conflict };
        }).pipe(Effect.provide(f.domain()))
      );

      await f.reopen();
      const before = f.context.db.orm.select().from(s.workflowEvents).all();

      for (const mutation of [
        sql`UPDATE blocks SET text='projection drift' WHERE document_id=${saved.draft.snapshotId}`,
        sql`UPDATE blocks SET kind='heading' WHERE document_id=${saved.draft.snapshotId}`,
        sql`UPDATE blocks SET content='{"type":"unsupported"}' WHERE document_id=${saved.draft.snapshotId}`,
        sql`UPDATE blocks SET content=${encodeBlockContent(paragraph('Substitution').content)} WHERE document_id=${saved.draft.snapshotId}`,
        sql`DELETE FROM content_snapshots WHERE id=${saved.draft.snapshotId}`
      ])
        test.assert.throws(() => f.context.db.orm.run(mutation));

      await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Pages;

          test.expect(yield* docs.version({ id: saved.draft.id })).toStrictEqual(saved.draft);
          test.expect(yield* docs.save(saved.intent)).toStrictEqual({
            ...saved.conflict,
            replayed: true
          });
          test.assert.ok(
            (yield* Effect.flip(
              docs.restore({
                pageId: saved.intent.pageId,
                expectedVersionId: saved.conflict.currentVersionId,
                restoreVersionId: saved.draft.id,
                key: 'invalid-draft-restore'
              })
            )).kind === 'invalid_input'
          );
          const restored = yield* docs.save({
            pageId: saved.intent.pageId,
            expectedVersionId: saved.conflict.currentVersionId,
            document: saved.draft.document,
            key: 'adopt-alternative'
          });

          test.assert.ok(restored.outcome === 'saved');
          test.assert.ok(
            (yield* docs.version({ id: restored.submittedVersionId })).document.blocks[0]?.text ===
              'Retained alternative'
          );
        }).pipe(Effect.provide(f.domain()))
      );
      test.assert.strictEqual(
        f.context.db.orm.select().from(s.workflowEvents).all().length,
        before.length + 1
      );
    } finally {
      await f.close();
    }
  }
);

test.stable(
  'authored image replacement and body retirement release only owned roots while independent copies retain exact bytes',
  async ({ databases }) => {
    const f = await pageTransformFixture(databases);
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;
          const docs = yield* Pages;
          const first = yield* sources.createSource({ name: 'first.png', bytes, projectId: null });
          const other = yield* sources.createSource({ name: 'other.png', bytes, projectId: null });
          const image = (sourceId: typeof first.id) =>
            createBlock({ type: 'image', sourceId, revision: 1, alt: 'Image' });
          const create = (title: string) =>
            docs.create({
              createKey: crypto.randomUUID(),
              title,
              document: { blocks: [image(first.id)], meta },
              inputs: [],
              citations: []
            });
          const original = yield* create('Original');
          const copy = yield* create('Independent copy');

          test.assert.ok(original.version);
          test.assert.ok(copy.version);
          const oldBlock = original.version.document.blocks[0]!;
          const replacement = image(other.id);
          const edit = yield* docs.save({
            pageId: original.id,
            expectedVersionId: original.version.id,
            key: crypto.randomUUID(),
            document: { blocks: [{ ...replacement, id: oldBlock.id }], meta }
          });

          test.assert.ok(edit.outcome === 'saved');
          const scope = { pageId: original.id, keepLatest: 1 };
          const preview = yield* docs.previewHistory(scope);

          yield* docs.retireHistory({ ...scope, token: preview.token });
          test.assert.strictEqual(
            f.context.db.orm.select().from(s.document_assets).all().length,
            2
          );
          const remove = yield* docs.previewDeletion({ id: original.id });

          yield* docs.delete({ pageId: original.id, token: remove.token });
          test.assert.strictEqual(
            f.context.db.orm.select().from(s.document_assets).all().length,
            1
          );
          test
            .expect((yield* sources.previewDeletion({ id: other.id })).blockedBy)
            .toStrictEqual([]);
          yield* sources.deleteSource({ id: other.id });
          test
            .expect((yield* sources.previewDeletion({ id: first.id })).blockedBy)
            .toStrictEqual(['image_assets']);

          return { first, copy: copy.version };
        }).pipe(Effect.provide(f.domain()))
      );

      await f.reopen();

      for (const mutation of [
        sql`UPDATE document_assets SET revision=999 WHERE source_id=${saved.first.id}`,
        sql`UPDATE source_snapshots SET bytes=x'00' WHERE source_id=${saved.first.id} AND revision=1`,
        sql`UPDATE source_snapshots SET mime='text/plain' WHERE source_id=${saved.first.id} AND revision=1`,
        sql`DELETE FROM source_snapshots WHERE source_id=${saved.first.id} AND revision=1`
      ])
        test.assert.throws(() => f.context.db.orm.run(mutation));

      await Effect.runPromise(
        Effect.gen(function* () {
          test
            .expect(
              (yield* (yield* Sources).sourceSnapshot({ id: saved.first.id, revision: 1 })).bytes
            )
            .toStrictEqual(bytes);
          test
            .expect(yield* (yield* Pages).version({ id: saved.copy.id }))
            .toStrictEqual(saved.copy);
        }).pipe(Effect.provide(f.domain()))
      );
      test.expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      test
        .expect(f.context.db.orm.all(sql`PRAGMA integrity_check`))
        .toStrictEqual([{ integrity_check: 'ok' }]);
    } finally {
      await f.close();
    }
  }
);
