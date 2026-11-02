/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises source export barriers and last-owner cleanup through native Material    │
 * │ APIs.                                                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves unselected exact byte copies while rejecting forged cleanup ownership.       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Tests use migrated SQLite with production guards and native cleanup Workflows.           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Effect } from 'effect';

import { Materials } from '#server/features/materials/index';
import { documentTransformFixture } from '#testing/document-transform';
import { acceptMaterialDeletion, cleanupMaterial } from '#testing/material-deletion';
import {
  assertExportUnavailable,
  assertSourceGone,
  materialExport,
  recordingSource,
  sourceBytes,
  sourceCopies
} from '#testing/material-deletion-sources';
import { awaitNativeStatus } from '#testing/session-deletion';

test('native export rejects accepted and failed deletion before scrub while an unselected pin exports exact bytes and metadata', async () => {
  const f = await documentTransformFixture();

  try {
    const saved = await sourceCopies(f, 'file');

    const original = await Effect.runPromise(materialExport(f, saved.originalVersionId));

    const copy = await Effect.runPromise(materialExport(f, saved.copy.version.id));

    assert.deepEqual(copy, original);

    assert.deepEqual(copy.bytes, saved.bytes);

    const accepted = await acceptMaterialDeletion(f, saved.original.id);

    await assertExportUnavailable(f, saved.originalVersionId);

    assert.deepEqual(await Effect.runPromise(materialExport(f, saved.copy.version.id)), copy);

    f.context.db.orm.run(
      sql.raw(
        "CREATE TRIGGER reject_export_scrub BEFORE DELETE ON material_source_snapshots BEGIN SELECT RAISE(ABORT,'injected'); END"
      )
    );

    await assert.rejects(cleanupMaterial(f, saved.original.id));

    await Effect.runPromise(
      awaitNativeStatus(f, `material-cleanup/${accepted.operationId}/1`, 'completed')
    );

    const status = await Effect.runPromise(
      Effect.flatMap(Materials, (m) => m.deletion({ materialId: saved.original.id })).pipe(
        Effect.provide(f.domain())
      )
    );

    assert.equal(status.status, 'failed');

    assert.ok(
      f.context.db.orm
        .select()
        .from(s.material_source_snapshots)
        .where(eq(s.material_source_snapshots.version_id, saved.originalVersionId))
        .get()
    );

    await assertExportUnavailable(f, saved.originalVersionId);

    assert.deepEqual(await Effect.runPromise(materialExport(f, saved.copy.version.id)), copy);

    f.context.db.orm.run(sql.raw('DROP TRIGGER reject_export_scrub'));

    f.reopen();

    await Effect.runPromise(
      Effect.flatMap(Materials, (m) => m.retryDeletion({ materialId: saved.original.id })).pipe(
        Effect.provide(f.domain())
      )
    );

    await cleanupMaterial(f, saved.original.id);

    f.reopen();

    await assertExportUnavailable(f, saved.originalVersionId);

    assert.deepEqual(await Effect.runPromise(materialExport(f, saved.copy.version.id)), copy);
  } finally {
    await f.close();
  }
});

for (const kind of ['file', 'image', 'recording'] as const) {
  test(`last independent ${kind} source pin releases all exclusive bytes after original cleanup and reopen`, async () => {
    const f = await documentTransformFixture();

    try {
      const saved = await sourceCopies(f, kind);

      const unrelatedRecordingId = kind === 'recording' ? await recordingSource(f) : null;

      const copy = await Effect.runPromise(materialExport(f, saved.copy.version.id));

      await acceptMaterialDeletion(f, saved.original.id);

      await cleanupMaterial(f, saved.original.id);

      f.reopen();

      assert.deepEqual(await Effect.runPromise(materialExport(f, saved.copy.version.id)), copy);

      assert.deepEqual(sourceBytes(f, saved.source.id), saved.bytes);

      if (kind === 'recording') {
        // A completed original alone grants no retirement authority while a copy still owns bytes.

        assert.throws(() =>
          f.context.db.orm
            .delete(s.source_blobs)
            .where(eq(s.source_blobs.source_id, saved.source.id))
            .run()
        );

        assert.throws(() =>
          f.context.db.orm
            .update(s.sources)
            .set({ name: '-', uri: null, sha256: Buffer.alloc(32), size_bytes: 1n })
            .where(eq(s.sources.id, saved.source.id))
            .run()
        );
      }

      await acceptMaterialDeletion(f, saved.copy.id);

      const candidates = f.context.db.orm
        .select()
        .from(s.source_material_deletion_assets)
        .where(eq(s.source_material_deletion_assets.deletion_id, saved.copy.id))
        .all();

      assert.deepEqual(candidates, [
        { deletion_id: saved.copy.id, source_id: saved.source.id, revision: 1n }
      ]);

      if (kind === 'recording') {
        assert.throws(() =>
          f.context.db.orm
            .update(s.sources)
            .set({ name: 'forged' })
            .where(eq(s.sources.id, saved.source.id))
            .run()
        );

        assert.throws(() =>
          f.context.db.orm
            .update(s.sources)
            .set({ mime: 'application/forged' })
            .where(eq(s.sources.id, saved.source.id))
            .run()
        );

        assert.ok(unrelatedRecordingId !== null);

        assert.throws(() =>
          f.context.db.orm
            .update(s.sources)
            .set({ name: '-', uri: null, sha256: Buffer.alloc(32), size_bytes: 1n })
            .where(eq(s.sources.id, unrelatedRecordingId))
            .run()
        );
      }

      await cleanupMaterial(f, saved.copy.id);

      f.reopen();
      assertSourceGone(f, saved.source.id);

      const completed = await Effect.runPromise(
        Effect.flatMap(Materials, (m) => m.deletion({ materialId: saved.copy.id })).pipe(
          Effect.provide(f.domain())
        )
      );

      assert.equal(completed.status, 'completed');

      if (kind === 'recording')
        assert.throws(() =>
          f.context.db.orm
            .update(s.sources)
            .set({ name: 'resurrected.wav' })
            .where(eq(s.sources.id, saved.source.id))
            .run()
        );

      await assertExportUnavailable(f, saved.originalVersionId);

      await assertExportUnavailable(f, saved.copy.version.id);

      assert.deepEqual(sourceBytes(f, saved.unrelated.id), saved.bytes);

      const equalHash = f.context.db.orm
        .select()
        .from(s.source_snapshots)
        .where(eq(s.source_snapshots.source_id, saved.unrelated.id))
        .all();

      assert.equal(equalHash.length, 1);

      assert.deepEqual(new Uint8Array(equalHash[0]!.bytes), saved.bytes);
    } finally {
      await f.close();
    }
  });
}

test('same-operation deletion follows a real dependency edge and candidate ownership cannot be forged or rewritten', async () => {
  const f = await documentTransformFixture();

  try {
    const saved = await sourceCopies(f, 'image', true);

    const accepted = await acceptMaterialDeletion(f, saved.original.id, [saved.copy.id]);

    assert.deepEqual(new Set(accepted.materialIds), new Set([saved.original.id, saved.copy.id]));

    const candidate = { deletion_id: saved.original.id, source_id: saved.source.id, revision: 1n };

    assert.deepEqual(f.context.db.orm.select().from(s.source_material_deletion_assets).all(), [
      candidate
    ]);

    assert.throws(() =>
      f.context.db.orm
        .insert(s.source_material_deletion_assets)
        .values({ ...candidate, source_id: saved.unrelated.id })
        .run()
    );

    assert.throws(() =>
      f.context.db.orm
        .insert(s.source_material_deletion_assets)
        .values({ ...candidate, revision: 999n })
        .run()
    );

    assert.throws(() =>
      f.context.db.orm
        .update(s.source_material_deletion_assets)
        .set({ revision: 2n })
        .where(eq(s.source_material_deletion_assets.deletion_id, saved.original.id))
        .run()
    );

    assert.throws(() =>
      f.context.db.orm
        .delete(s.source_material_deletion_assets)
        .where(eq(s.source_material_deletion_assets.deletion_id, saved.original.id))
        .run()
    );

    assert.equal(
      f.context.db.orm.get<{ foreign_keys: bigint }>(sql`PRAGMA foreign_keys`)?.foreign_keys,
      1n
    );

    await cleanupMaterial(f, saved.original.id);

    f.reopen();
    assertSourceGone(f, saved.source.id);

    assert.deepEqual(sourceBytes(f, saved.unrelated.id), saved.bytes);

    assert.deepEqual(f.context.db.orm.select().from(s.source_material_deletion_assets).all(), [
      candidate
    ]);
  } finally {
    await f.close();
  }
});
