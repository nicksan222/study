import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { createBlock } from '@study/contracts/sources/document';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
/** Roundtrips final-domain body retirement, exact source pins and private session cleanup. */
import { testStable } from '@study/testing/node';
import { Effect } from 'effect';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import { Sources } from '#server/features/sources/index';
import { documentTransformFixture } from '#testing/document-transform';
import { exportSnapshot, restoreSnapshot, meta } from '#testing/managed-backups';
import { deletionDocument } from '#testing/material-deletion';
import { processSource } from '#testing/material-history';
import { setup, cleanup as cleanupSession, assertScrubbed } from '#testing/session-deletion';

for (const kind of ['file', 'image'] as const)
  testStable(
    `authored retirement preserves independent ${kind} source pins and revoked exports after restore`,
    async () => {
      const source = await documentTransformFixture();
      let target: Awaited<ReturnType<typeof restoreSnapshot>> | undefined;
      try {
        const bytes =
          kind === 'image'
            ? new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
            : new TextEncoder().encode('Exact original bytes');
        const originalSource = await Effect.runPromise(
          Effect.flatMap(Sources, (owner) =>
            owner.createSource({
              name: kind === 'image' ? 'pixel.png' : 'original.txt',
              bytes,
              projectId: null
            })
          ).pipe(Effect.provide(source.domain()))
        );
        // Text ingestion exercises the real native extraction owner. Images are authored roots of
        // original bytes; they need no artificial extraction or fake source Material.
        const extracted = kind === 'file' ? await processSource(source) : null;
        const saved = await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;
            const create = (title: string) =>
              extracted
                ? docs.copySource({
                    createKey: randomUUID(),
                    title,
                    sourceId: originalSource.id,
                    revision: 1n,
                    snapshotId: extracted.documentId
                  })
                : docs.create({
                    createKey: randomUUID(),
                    title,
                    document: {
                      meta,
                      blocks: [
                        createBlock({
                          type: 'image',
                          sourceId: originalSource.id,
                          revision: 1,
                          alt: 'Shared image'
                        })
                      ]
                    },
                    inputs: [],
                    citations: []
                  });
            const original = yield* create('Retired authored output');
            const copy = yield* create('Independent retained output');
            assert.ok(original.version);
            assert.ok(copy.version);
            const expected = yield* docs.exportVersion({ id: copy.version.id });
            const preview = yield* docs.previewDeletion({ id: original.id });
            assert.deepEqual(preview.blockedVersionIds, []);
            yield* docs.delete({ documentId: original.id, token: preview.token });
            return {
              originalId: original.id,
              originalVersionId: original.version.id,
              copyVersionId: copy.version.id,
              expected
            };
          }).pipe(Effect.provide(source.domain()))
        );
        const backup = await exportSnapshot(source.context.db);
        await source.close();
        target = await restoreSnapshot(backup);
        const app = target.app;
        const docs = await app.nativeRuntime.runPromise(Documents);
        assert.equal(
          (
            await app.nativeRuntime.runPromise(
              Effect.flip(docs.exportVersion({ id: saved.originalVersionId }))
            )
          ).kind,
          'not_found'
        );
        assert.deepEqual(
          await app.nativeRuntime.runPromise(docs.exportVersion({ id: saved.copyVersionId })),
          saved.expected
        );
        assert.deepEqual(
          new Uint8Array(
            app.store.db.orm
              .select()
              .from(s.source_blobs)
              .where(eq(s.source_blobs.source_id, originalSource.id))
              .get()!.bytes
          ),
          bytes
        );
        const owner = await app.nativeRuntime.runPromise(Sources);
        assert.ok(
          (await app.nativeRuntime.runPromise(owner.previewDeletion({ id: originalSource.id })))
            .blockedBy.length
        );
        if (kind === 'image')
          assert.equal(app.store.db.orm.select().from(s.document_assets).all().length, 1);
        await app.workers.start();
        await app.workers.stop();
        assert.equal(
          (
            await app.nativeRuntime.runPromise(
              Effect.flip(docs.version({ id: saved.originalVersionId }))
            )
          ).kind,
          'not_found'
        );
        assert.deepEqual(app.store.db.orm.all(sql`PRAGMA foreign_key_check`), []);
      } finally {
        await target?.close();
        await source.close();
      }
    }
  );

testStable(
  'authored history retirement protects exact dependents before restoring unavailable bodies and independent current history',
  async () => {
    const source = await documentTransformFixture();
    let target: Awaited<ReturnType<typeof restoreSnapshot>> | undefined;
    try {
      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const docs = yield* Documents;
          const create = (
            title: string,
            text: string,
            inputs: Parameters<typeof docs.create>[0]['inputs'] = []
          ) =>
            docs.create({
              createKey: randomUUID(),
              title,
              document: deletionDocument(text),
              inputs,
              citations: []
            });
          const root = yield* create('Retire history', 'PRIVATE_PRUNED_BODY');
          assert.ok(root.version);
          const current = yield* docs.save({
            documentId: root.id,
            expectedVersionId: root.version.id,
            key: randomUUID(),
            document: deletionDocument('Current body')
          });
          const dependent = yield* create('Exact dependent', 'Dependent body', [
            { kind: 'document', versionId: root.version.id }
          ]);
          const independent = yield* create('Independent', 'Independent body');
          assert.ok(independent.version);
          const scope = { documentId: root.id, keepLatest: 1 };
          const blocked = yield* docs.previewHistory(scope);
          assert.deepEqual(blocked.blockedVersionIds, [root.version.id]);
          assert.equal(
            (yield* Effect.flip(docs.retireHistory({ ...scope, token: blocked.token }))).kind,
            'invalid_input'
          );
          const removeDependent = yield* docs.previewDeletion({ id: dependent.id });
          yield* docs.delete({ documentId: dependent.id, token: removeDependent.token });
          const preview = yield* docs.previewHistory(scope);
          assert.deepEqual(preview.blockedVersionIds, []);
          yield* docs.retireHistory({ ...scope, token: preview.token });
          return {
            rootId: root.id,
            old: root.version.id,
            current: current.submittedVersionId,
            independent: independent.version.id
          };
        }).pipe(Effect.provide(source.domain()))
      );
      assertScrubbed(source, 'PRIVATE_PRUNED_BODY');
      const bytes = await exportSnapshot(source.context.db);
      await source.close();
      target = await restoreSnapshot(bytes);
      const app = target.app;
      const docs = await app.nativeRuntime.runPromise(Documents);
      assert.equal(
        (await app.nativeRuntime.runPromise(Effect.flip(docs.version({ id: saved.old })))).kind,
        'not_found'
      );
      assert.equal(
        (await app.nativeRuntime.runPromise(Effect.flip(docs.exportVersion({ id: saved.old }))))
          .kind,
        'not_found'
      );
      assert.equal(
        (await app.nativeRuntime.runPromise(docs.version({ id: saved.current }))).document.blocks[0]
          ?.text,
        'Current body'
      );
      assert.equal(
        (await app.nativeRuntime.runPromise(docs.version({ id: saved.independent }))).document
          .blocks[0]?.text,
        'Independent body'
      );
      assert.equal(app.store.db.orm.select().from(s.study_document_retirements).all().length, 2);
      const api = await target.api();
      const next = await app.nativeRuntime.runPromise(api.createBackup());
      assert.equal(
        (await app.nativeRuntime.runPromise(api.previewRestore({ id: next.id })))
          .blockedByCurrentBarriers,
        true
      );
      assert.deepEqual(app.store.db.orm.all(sql`PRAGMA foreign_key_check`), []);
    } finally {
      await target?.close();
      await source.close();
    }
  }
);

testStable(
  'completed session cleanup roundtrips content-free private captures and independent library history',
  async () => {
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
            Effect.flatMap(Documents, (m) => m.version({ id: saved.library.version.id }))
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
  }
);
