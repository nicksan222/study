/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Roundtrips completed owner-produced deletion and exact history barriers.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves shared source/image bytes and independent publications after fresh restore.  │
 * │ - Rejects unavailable history, revoked exports and captured session authority.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Real SQLite, public services and native cleanup Workflows retain all production guards.  │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBlock } from '@study/contracts/sources/document';
import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { Effect } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Materials } from '#server/features/materials/index';
import { documentTransformFixture } from '#testing/document-transform';
import { exportSnapshot, restoreSnapshot, meta } from '#testing/managed-backups';
import {
  acceptMaterialDeletion,
  cleanupMaterial,
  deletionDocument
} from '#testing/material-deletion';
import { materialExport, sourceCopies } from '#testing/material-deletion-sources';
import { acceptHistory, cleanupHistory } from '#testing/material-history';
import { setup, cleanup as cleanupSession, assertScrubbed } from '#testing/session-deletion';

for (const kind of ['file', 'image'] as const)
  test(`completed Material deletion preserves independent ${kind} pins and exact revoked-export semantics after restore`, async () => {
    const source = await documentTransformFixture();

    let target: Awaited<ReturnType<typeof restoreSnapshot>> | undefined;

    try {
      const saved = await sourceCopies(source, kind);

      const expected = await Effect.runPromise(materialExport(source, saved.copy.version.id));

      const document =
        kind === 'image'
          ? await Effect.runPromise(
              Effect.flatMap(Materials, (materials) =>
                materials.createManualDocument({
                  title: 'Independent image document',
                  document: {
                    meta,
                    blocks: [
                      createBlock({
                        type: 'image',
                        sourceId: saved.source.id,
                        revision: 1,
                        alt: 'Shared image'
                      })
                    ]
                  }
                })
              ).pipe(Effect.provide(source.domain()))
            )
          : null;
      await acceptMaterialDeletion(source, saved.original.id);

      await cleanupMaterial(source, saved.original.id);

      const bytes = await exportSnapshot(source.context.db);

      await source.close();
      target = await restoreSnapshot(bytes);

      const app = target.app;

      const materials = await app.nativeRuntime.runPromise(Materials);

      assert.equal(
        (await app.nativeRuntime.runPromise(materials.deletion({ materialId: saved.original.id })))
          .status,
        'completed'
      );
      assert.equal(
        (
          await app.nativeRuntime.runPromise(
            Effect.flip(materials.materialVersionExport({ id: saved.originalVersionId }))
          )
        ).kind,
        'not_found'
      );
      assert.deepEqual(
        await app.nativeRuntime.runPromise(
          materials.materialVersionExport({ id: saved.copy.version.id })
        ),
        expected
      );

      if (document) {
        assert.equal(
          (
            await app.nativeRuntime.runPromise(
              materials.materialVersion({ id: document.version.id })
            )
          ).id,
          document.version.id
        );
        assert.equal(app.store.db.orm.select().from(s.document_assets).all().length, 1);
      }

      assert.deepEqual(
        new Uint8Array(
          app.store.db.orm
            .select()
            .from(s.source_blobs)
            .where(eq(s.source_blobs.source_id, saved.source.id))
            .get()!.bytes
        ),
        saved.bytes
      );
      await app.workers.start();
      await app.workers.stop();
      assert.equal(
        (
          await app.nativeRuntime.runPromise(
            Effect.flip(materials.materialVersionExport({ id: saved.originalVersionId }))
          )
        ).kind,
        'not_found'
      );
    } finally {
      await target?.close();
      await source.close();
    }
  });

test('completed exact history prune restores unavailable evidence while current and independent versions survive', async () => {
  const source = await documentTransformFixture();

  let target: Awaited<ReturnType<typeof restoreSnapshot>> | undefined;

  try {
    const saved = await Effect.runPromise(
      Effect.gen(function* () {
        const m = yield* Materials;

        const root = yield* m.create({
          title: 'Prune',
          content: { kind: 'document', ...deletionDocument('PRIVATE_PRUNED_BODY') },
          publish: true
        });

        const current = yield* m.createVersion({
          materialId: root.id,
          content: { kind: 'document', ...deletionDocument('Current body') },
          publish: true
        });

        const independent = yield* m.create({
          title: 'Independent derivative',
          content: { kind: 'document', ...deletionDocument('Independent body') },
          inputs: [root.version.id],
          publish: true
        });

        return { root, current, independent };
      }).pipe(Effect.provide(source.domain()))
    );

    await acceptHistory(source, saved.root.id, 'backup-history');
    await cleanupHistory(source, 'backup-history');
    assertScrubbed(source, 'PRIVATE_PRUNED_BODY');

    const bytes = await exportSnapshot(source.context.db);

    await source.close();
    target = await restoreSnapshot(bytes);

    const app = target.app;

    const m = await app.nativeRuntime.runPromise(Materials);

    assert.equal(
      (await app.nativeRuntime.runPromise(m.historyPrune({ operationId: 'backup-history' })))
        .status,
      'completed'
    );
    assert.equal(
      (
        await app.nativeRuntime.runPromise(
          Effect.flip(m.materialVersion({ id: saved.root.version.id }))
        )
      ).kind,
      'not_found'
    );

    const evidence = await app.nativeRuntime.runPromise(
      m.resolveEvidence({
        kind: 'anchor',
        versionId: saved.root.version.id,
        anchor: { type: 'authored' },
        quote: 'PRIVATE_PRUNED_BODY'
      })
    );

    assert.equal(evidence.availability, 'unavailable');

    if (evidence.availability === 'unavailable') assert.equal(evidence.reason, 'version_pruned');

    assert.equal(
      (await app.nativeRuntime.runPromise(m.materialVersion({ id: saved.current.id }))).id,
      saved.current.id
    );
    assert.equal(
      (await app.nativeRuntime.runPromise(m.materialVersion({ id: saved.independent.version.id })))
        .id,
      saved.independent.version.id
    );
    assert.equal(
      (
        await app.nativeRuntime.runPromise(
          m.inputs({ id: saved.independent.version.id, limit: 10 })
        )
      ).items[0]?.availability,
      'unavailable'
    );

    const api = await target.api();

    const next = await app.nativeRuntime.runPromise(api.createBackup());

    assert.equal(
      (await app.nativeRuntime.runPromise(api.previewRestore({ id: next.id })))
        .blockedByCurrentBarriers,
      true
    );
  } finally {
    await target?.close();
    await source.close();
  }
});

test('completed session cleanup roundtrips content-free private captures and independent library history', async () => {
  const source = await documentTransformFixture();

  let target: Awaited<ReturnType<typeof restoreSnapshot>> | undefined;

  try {
    const saved = await setup(source, 'PRIVATE_SESSION_BODY_BACKUP');

    await Effect.runPromise(
      Effect.flatMap(Conversations, (c) => c.deleteSession(saved.session.id)).pipe(
        Effect.provide(source.domain())
      )
    );
    await cleanupSession(source, saved.session.id);
    assertScrubbed(source, 'PRIVATE_SESSION_BODY_BACKUP');

    const bytes = await exportSnapshot(source.context.db);

    await source.close();
    target = await restoreSnapshot(bytes);

    const app = target.app;

    const c = await app.nativeRuntime.runPromise(Conversations);

    assert.equal(
      (await app.nativeRuntime.runPromise(c.sessionDeletion(saved.session.id))).status,
      'completed'
    );
    assert.equal(
      (await app.nativeRuntime.runPromise(Effect.flip(c.session(saved.session.id)))).kind,
      'not_found'
    );
    assert.equal(
      (
        await app.nativeRuntime.runPromise(
          Effect.flip(c.sessionContext({ requestId: saved.capture.requestId }))
        )
      ).kind,
      'not_found'
    );
    assert.equal(
      (await app.nativeRuntime.runPromise(c.thread({ sessionId: saved.other.id, limit: 10 })))
        .items[0]?.versions[0]?.text,
      'Other conversation'
    );
    assert.equal(
      (
        await app.nativeRuntime.runPromise(
          Effect.flatMap(Materials, (m) => m.materialVersion({ id: saved.library.version.id }))
        )
      ).id,
      saved.library.version.id
    );
    assert.equal(app.store.db.orm.select().from(s.workflow_activities).all().length, 0);
    assert.ok(
      app.store.db.orm
        .select()
        .from(s.workflowEvents)
        .all()
        .every((e) => e.payload === '{}')
    );
    assert.ok(
      app.store.db.orm
        .select()
        .from(s.workflow_executions)
        .all()
        .every((e) => e.payload === '{}' && e.owner_token === null)
    );
    await app.workers.start();
    await app.workers.stop();
    assert.equal(
      (
        await app.nativeRuntime.runPromise(
          Effect.flip(c.postMessage({ sessionId: saved.session.id, text: 'Cannot resurrect' }))
        )
      ).kind,
      'not_found'
    );
  } finally {
    await target?.close();
    await source.close();
  }
});
