/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Hardens canonical document retry, publication and managed asset boundaries.        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Rejects historical empty evidence and corrupt draft publication through services.      │
 * │ - Verifies copied snapshot roots survive draft replacement and database reopen.          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses real migrated SQLite and public services without remote providers or guard changes. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { materialGenerationPayloadSchema } from '@study/contracts/materials/schemas';
import type { MaterialContentInput } from '@study/contracts/materials/schemas';
import { createBlock, encodeBlockContent } from '@study/contracts/sources/document';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { Effect, Layer, Schema } from 'effect';

import { Materials } from '#server/features/materials/index';
import { Projects } from '#server/features/projects/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

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

const content = {
  kind: 'document',
  blocks: [
    createBlock({ type: 'paragraph', inlines: [{ type: 'text', text: 'Evidence', marks: [] }] })
  ],
  meta
} satisfies MaterialContentInput;

test('persisted separator-only generation intent is rejected on retry after reopen without publishing an event', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  const services = () =>
    Layer.mergeAll(Materials.layer, Projects.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

  try {
    const empty = await Effect.runPromise(
      Effect.gen(function* () {
        const projects = yield* Projects;
        const materials = yield* Materials;
        const project = yield* projects.createProject({ name: 'Historical request' });
        const document = yield* materials.create({
          projectId: project.id,
          title: 'Empty cells',
          content: {
            ...content,
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
          }
        });

        return { project, document };
      }).pipe(Effect.provide(services()))
    );
    const payload = Schema.encodeSync(
      Schema.fromJsonString(Schema.toCodecJson(materialGenerationPayloadSchema))
    )({
      title: 'Previously accepted empty table',
      kind: 'diagram',
      inputVersionIds: [empty.document.version.id]
    });

    // Model durable intent accepted by the earlier evidence predicate, without changing guards.
    context.db.orm
      .insert(s.material_generation_requests)
      .values({
        id: 'historical-empty-table',
        project_id: empty.project.id,
        payload,
        created_at: 1n
      })
      .run();
    context.db.orm
      .insert(s.material_generation_inputs)
      .values({
        request_id: 'historical-empty-table',
        version_id: empty.document.version.id,
        position: 0n
      })
      .run();
    context.close();
    context = new ServerContext(location.open());
    const eventsBefore = context.db.orm.select().from(s.workflowEvents).all();

    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;

        assert.equal(
          (yield* Effect.flip(
            materials.retryMaterialGenerationOnce({
              requestId: 'historical-empty-table',
              retryId: 'must-not-publish'
            })
          )).kind,
          'invalid_input'
        );
        assert.equal(
          (yield* Effect.flip(
            materials.materialGeneration({
              requestId: 'historical-empty-table'
            })
          )).kind,
          'invalid_input'
        );
        assert.equal(
          (yield* materials.materialVersion({ id: empty.document.version.id })).status,
          'published'
        );
      }).pipe(Effect.provide(services()))
    );
    assert.deepEqual(context.db.orm.select().from(s.workflowEvents).all(), eventsBefore);
    assert.equal(context.db.orm.select().from(s.material_generation_requests).all().length, 1);
    assert.equal(context.db.orm.select().from(s.material_generation_inputs).all().length, 1);
    assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('invalid rich input rolls back while corrupt persisted drafts fail internally and cannot publish', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  const services = () =>
    Materials.layer.pipe(Layer.provideMerge(Layer.succeed(Database, { store: context })));

  try {
    const draft = await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;

        assert.equal(
          (yield* Effect.flip(
            materials.create({
              title: 'Invalid kind',
              content: { ...content, blocks: [{ ...content.blocks[0]!, kind: 'heading' }] }
            })
          )).kind,
          'invalid_input'
        );
        assert.equal(context.db.orm.select().from(s.materials).all().length, 0);
        assert.equal(context.db.orm.select().from(s.documents).all().length, 0);

        return yield* materials.create({ title: 'Draft', content, publish: false });
      }).pipe(Effect.provide(services()))
    );
    const documentId = context.db.orm.get<{ document_id: bigint }>(
      sql`SELECT document_id FROM material_document_versions WHERE version_id=${draft.version.id}`
    )!.document_id;

    context.close();
    context = new ServerContext(location.open());
    const eventsBefore = context.db.orm.select().from(s.workflowEvents).all();

    for (const corrupt of [
      sql`UPDATE blocks SET text='projection drift' WHERE document_id=${documentId}`,
      sql`UPDATE blocks SET kind='heading' WHERE document_id=${documentId}`,
      sql`UPDATE blocks SET content='{"type":"paragraph","inlines":[{"type":"unsupported"}]}' WHERE document_id=${documentId}`
    ]) {
      context.db.orm.run(corrupt);
      await Effect.runPromise(
        Effect.gen(function* () {
          const materials = yield* Materials;

          assert.equal(
            (yield* Effect.flip(materials.materialVersion({ id: draft.version.id }))).kind,
            'internal'
          );
          assert.equal(
            (yield* Effect.flip(materials.publishVersion({ id: draft.version.id }))).kind,
            'internal'
          );
        }).pipe(Effect.provide(services()))
      );
      assert.equal(
        context.db.orm.get<{ status: string }>(
          sql`SELECT status FROM material_versions WHERE id=${draft.version.id}`
        )!.status,
        'draft'
      );
      assert.deepEqual(context.db.orm.select().from(s.workflowEvents).all(), eventsBefore);
      context.db.orm.run(sql`UPDATE blocks SET kind=${content.blocks[0]!.kind},
        text=${content.blocks[0]!.text},content=${encodeBlockContent(content.blocks[0]!.content)}
        WHERE document_id=${documentId}`);
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        const materials = yield* Materials;
        const published = yield* materials.publishVersion({ id: draft.version.id });

        assert.equal(published.status, 'published');
        assert.deepEqual(published.content, content);
      }).pipe(Effect.provide(services()))
    );
    assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
  } finally {
    context.close();
    location.cleanup();
  }
});

test('draft asset replacement releases only its own roots and copied published snapshots remain immutable', async () => {
  const location = createTestDatabase();
  let context = new ServerContext(location.open());
  const services = () =>
    Layer.mergeAll(Materials.layer, Sources.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );
  const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  try {
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const sources = yield* Sources;
        const materials = yield* Materials;
        const image = yield* sources.createSource({
          projectId: null,
          name: 'first.png',
          bytes: imageBytes
        });
        const other = yield* sources.createSource({
          projectId: null,
          name: 'second.png',
          bytes: imageBytes
        });
        const imageBlock = createBlock({
          type: 'image',
          sourceId: image.id,
          revision: 1,
          alt: 'First'
        });
        const original = { ...content, blocks: [imageBlock] };
        const copy = yield* materials.create({ title: 'Retained copy', content: original });
        const draft = yield* materials.createVersion({
          materialId: copy.id,
          content: original,
          publish: false
        });
        const revised = yield* materials.replaceDraft({
          id: draft.id,
          content: {
            ...content,
            blocks: [
              createBlock(
                {
                  type: 'image',
                  sourceId: other.id,
                  revision: 1,
                  alt: 'Second'
                },
                imageBlock.anchor,
                imageBlock.id
              )
            ]
          }
        });

        assert.equal(
          revised.content.kind === 'document' && revised.content.blocks[0]!.id,
          imageBlock.id
        );
        assert.deepEqual(
          context.db.orm.all<{ source_id: bigint; revision: bigint }>(
            sql`SELECT source_id,revision FROM document_assets ORDER BY source_id`
          ),
          [
            { source_id: image.id, revision: 1n },
            { source_id: other.id, revision: 1n }
          ]
        );
        yield* materials.deleteDraft({ id: draft.id });
        assert.deepEqual(
          context.db.orm.all<{ source_id: bigint; revision: bigint }>(
            sql`SELECT source_id,revision FROM document_assets`
          ),
          [{ source_id: image.id, revision: 1n }]
        );

        return { image, other, copy, original };
      }).pipe(Effect.provide(services()))
    );

    context.close();
    context = new ServerContext(location.open());

    for (const mutation of [
      sql`UPDATE document_assets SET source_id=${saved.other.id} WHERE source_id=${saved.image.id}`,
      sql`UPDATE source_snapshots SET bytes=x'00' WHERE source_id=${saved.image.id} AND revision=1`,
      sql`UPDATE source_snapshots SET mime='text/plain' WHERE source_id=${saved.image.id} AND revision=1`,
      sql`DELETE FROM source_snapshots WHERE source_id=${saved.image.id} AND revision=1`
    ])
      assert.throws(() => context.db.orm.run(mutation));

    await Effect.runPromise(
      Effect.gen(function* () {
        const sources = yield* Sources;
        const materials = yield* Materials;

        assert.deepEqual(
          (yield* sources.sourceSnapshot({ id: saved.image.id, revision: 1 })).bytes,
          imageBytes
        );
        assert.deepEqual(
          (yield* materials.material({ id: saved.copy.id })).version.content,
          saved.original
        );
      }).pipe(Effect.provide(services()))
    );
    assert.deepEqual(context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    assert.deepEqual(context.db.orm.all(sql`PRAGMA integrity_check`), [{ integrity_check: 'ok' }]);
  } finally {
    context.close();
    location.cleanup();
  }
});
