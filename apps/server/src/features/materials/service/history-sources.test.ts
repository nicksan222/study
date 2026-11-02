/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises corrected source Documents and exact shared byte ownership after prune.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves current exports and independent source and managed-image copies.             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Public import, correction and native projection retain all production SQLite guards.     │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Effect } from 'effect';

import { Materials } from '#server/features/materials/index';
import { makeCreateMaterial } from '#server/features/materials/store/create-material';
import { Sources } from '#server/features/sources/index';
import { documentTransformFixture } from '#testing/document-transform';
import {
  acceptMaterialDeletion,
  cleanupMaterial,
  deletionDocument
} from '#testing/material-deletion';
import {
  materialExport,
  sourceBytes,
  sourceCopies,
  assertSourceGone
} from '#testing/material-deletion-sources';
import { acceptHistory, cleanupHistory, processSource } from '#testing/material-history';
import { assertScrubbed } from '#testing/session-deletion';

test('unchanged source bytes allow obsolete corrected Documents to prune while original, current and in-flight roots remain usable', async () => {
  const f = await documentTransformFixture();

  try {
    const bytes = new TextEncoder().encode('Original source evidence');

    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const source = yield* (yield* Sources).createSource({
          name: 'corrections.txt',
          bytes,
          projectId: null
        });

        const original = (yield* (yield* Materials).materials({ archived: false, limit: 10 }))
          .items[0];

        assert.ok(original);

        return { source, original };
      }).pipe(Effect.provide(f.domain()))
    );

    const first = await processSource(f);

    const corrected = [];

    for (const after of ['First corrected evidence', 'Current corrected evidence']) {
      await Effect.runPromise(
        Effect.gen(function* () {
          const sources = yield* Sources;

          const before = yield* sources.sourceDocument(saved.source.id);

          yield* sources.correctBlock({
            id: saved.source.id,
            documentId: before.id,
            ordinal: 0,
            before: before.document.blocks[0]!.text,
            after
          });

          const preview = yield* (yield* Materials).previewHistoryPrune({
            materialId: saved.original.id,
            policy: { keepLatest: 1 }
          });

          const pin = f.context.db.orm
            .select()
            .from(s.material_source_snapshots)
            .where(eq(s.material_source_snapshots.document_id, before.id))
            .get();

          assert.ok(pin);

          assert.ok(!preview.candidateIds.includes(pin.version_id));

          assert.equal((yield* sources.sourceProcessing(saved.source.id)).revision, 1);
        }).pipe(Effect.provide(f.domain()))
      );

      corrected.push(await processSource(f, true));
    }

    const current = corrected[1]!;

    const originalExport = await Effect.runPromise(materialExport(f, saved.original.version.id));

    const currentExport = await Effect.runPromise(
      materialExport(f, current.projected.extracted.version.id)
    );

    const preview = await Effect.runPromise(
      Effect.flatMap(Materials, (m) =>
        m.previewHistoryPrune({ materialId: saved.original.id, policy: { keepLatest: 1 } })
      ).pipe(Effect.provide(f.domain()))
    );

    assert.deepEqual(preview.candidateIds, [
      first.projected.extracted.version.id,
      corrected[0]!.projected.extracted.version.id
    ]);

    assert.ok(
      preview.protected.some(
        (p) => p.versionId === saved.original.version.id && p.reason === 'source_root'
      )
    );

    assert.ok(
      preview.sourceRevisions.some(
        (r) =>
          r.sourceId === saved.source.id &&
          r.revision === 1n &&
          r.retained &&
          r.currentSourceRevision
      )
    );

    await acceptHistory(f, saved.original.id, 'correction-history');

    for (const protectedId of [saved.original.version.id, current.projected.extracted.version.id]) {
      assert.throws(() =>
        f.context.db.orm
          .insert(s.material_history_members)
          .values({ operation_id: 'correction-history', version_id: protectedId })
          .run()
      );
    }

    assert.throws(() =>
      f.context.db.orm
        .insert(s.source_history_documents)
        .values({ operation_id: 'correction-history', document_id: current.documentId })
        .run()
    );

    assert.throws(() =>
      f.context.db.orm
        .insert(s.source_history_revisions)
        .values({ operation_id: 'correction-history', source_id: saved.source.id, revision: 999n })
        .run()
    );

    await cleanupHistory(f, 'correction-history');

    f.reopen();

    assertScrubbed(f, 'First corrected evidence');

    for (const old of [first, corrected[0]!]) {
      assert.equal(
        f.context.db.orm.select().from(s.documents).where(eq(s.documents.id, old.documentId)).get(),
        undefined
      );

      assert.deepEqual(
        f.context.db.orm
          .select()
          .from(s.blocks)
          .where(eq(s.blocks.document_id, old.documentId))
          .all(),
        []
      );
    }

    assert.deepEqual(
      await Effect.runPromise(materialExport(f, saved.original.version.id)),
      originalExport
    );

    assert.deepEqual(
      await Effect.runPromise(materialExport(f, current.projected.extracted.version.id)),
      currentExport
    );

    assert.deepEqual(sourceBytes(f, saved.source.id), bytes);

    assert.deepEqual(
      new Uint8Array(
        f.context.db.orm
          .select()
          .from(s.source_snapshots)
          .where(eq(s.source_snapshots.source_id, saved.source.id))
          .get()!.bytes
      ),
      bytes
    );

    await Effect.runPromise(
      Effect.flatMap(Sources, (sources) =>
        sources.correctBlock({
          id: saved.source.id,
          documentId: current.documentId,
          ordinal: 0,
          before: 'Current corrected evidence',
          after: 'Correction after pruning'
        })
      ).pipe(Effect.provide(f.domain()))
    );

    const next = await processSource(f, true);

    assert.notEqual(next.documentId, current.documentId);

    assert.equal(next.projected.extracted.id, saved.original.id);

    assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
  } finally {
    await f.close();
  }
});

for (const managed of [false, true]) {
  test(`${managed ? 'managed image' : 'source-version'} copies retain exact revisions through pruning and release bytes only after the final owner`, async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await sourceCopies(f, managed ? 'image' : 'file');

      const roots = await Effect.runPromise(
        Effect.gen(function* () {
          const m = yield* Materials;

          const content = {
            kind: 'document' as const,
            ...deletionDocument('Independent asset owner'),
            ...(managed
              ? {
                  blocks: [
                    createBlock({
                      type: 'image',
                      sourceId: saved.source.id,
                      revision: 1,
                      alt: 'Exact retained image'
                    })
                  ]
                }
              : {})
          };

          const owner = managed
            ? yield* m.create({ title: 'Image owner', content, publish: true })
            : f.context.transaction(() =>
                makeCreateMaterial({ db: f.context.db, clock: f.context.clock }).createMaterial({
                  title: 'Source-version owner',
                  operation: 'extract',
                  content: { kind: 'file', sourceId: saved.source.id },
                  publish: true
                })
              );

          const copy = managed
            ? yield* m.create({ title: 'Copied image', content, publish: true })
            : null;

          const current = yield* m.createVersion({
            materialId: owner.id,
            content: managed
              ? { kind: 'document', ...deletionDocument('Current owner without asset') }
              : { kind: 'file', sourceId: saved.unrelated.id },
            publish: true
          });

          return { owner, copy, current };
        }).pipe(Effect.provide(f.domain()))
      );

      const copyExport = await Effect.runPromise(materialExport(f, saved.copy.version.id));

      const accepted = await acceptHistory(f, roots.owner.id, 'shared-source-history');

      assert.deepEqual(accepted.candidateIds, [roots.owner.version.id]);

      await assert.rejects(acceptMaterialDeletion(f, roots.owner.id));

      await cleanupHistory(f, accepted.operationId);

      f.reopen();

      assert.deepEqual(sourceBytes(f, saved.source.id), saved.bytes);

      assert.equal(
        (
          await Effect.runPromise(
            Effect.flatMap(Materials, (m) => m.material({ id: roots.owner.id })).pipe(
              Effect.provide(f.domain())
            )
          )
        ).version.id,
        roots.current.id
      );

      assert.deepEqual(sourceBytes(f, saved.unrelated.id), saved.bytes);

      assert.deepEqual(
        await Effect.runPromise(materialExport(f, saved.copy.version.id)),
        copyExport
      );

      await acceptMaterialDeletion(f, saved.copy.id);

      await cleanupMaterial(f, saved.copy.id);

      await acceptMaterialDeletion(f, saved.original.id);

      await cleanupMaterial(f, saved.original.id);

      f.reopen();

      if (managed) {
        assert.ok(roots.copy);

        const version = await Effect.runPromise(
          Effect.flatMap(Materials, (m) => m.materialVersion({ id: roots.copy!.version.id })).pipe(
            Effect.provide(f.domain())
          )
        );

        assert.equal(version.content.kind, 'document');

        assert.deepEqual(version, roots.copy.version);

        assert.equal(
          f.context.db.orm
            .select()
            .from(s.source_blobs)
            .where(eq(s.source_blobs.source_id, saved.source.id))
            .get(),
          undefined
        );

        const asset = f.context.db.orm
          .select()
          .from(s.document_assets)
          .where(eq(s.document_assets.source_id, saved.source.id))
          .get();

        assert.ok(asset);

        assert.equal(asset.revision, 1n);

        assert.equal(
          f.context.db.orm
            .select()
            .from(s.material_document_versions)
            .where(eq(s.material_document_versions.version_id, roots.copy.version.id))
            .get()?.document_id,
          asset.document_id
        );

        const snapshot = f.context.db.orm
          .select()
          .from(s.source_snapshots)
          .where(eq(s.source_snapshots.source_id, saved.source.id))
          .get();

        assert.equal(snapshot?.revision, asset.revision);

        assert.deepEqual(new Uint8Array(snapshot!.bytes), saved.bytes);

        await acceptMaterialDeletion(f, roots.copy.id);

        await cleanupMaterial(f, roots.copy.id);
      }

      await acceptMaterialDeletion(f, roots.owner.id);

      await cleanupMaterial(f, roots.owner.id);

      f.reopen();

      assertSourceGone(f, saved.source.id);

      assert.deepEqual(sourceBytes(f, saved.unrelated.id), saved.bytes);

      assert.deepEqual(f.context.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      await f.close();
    }
  });
}
