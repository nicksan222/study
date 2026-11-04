/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Retained raw citations protect exact authored bodies after private capture         │
 * │ retirement.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies retained identities and exact raw citation retention invariants.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { sql } from '@study/db';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { Documents } from '#server/features/documents/index';
import { Workflows } from '#server/features/workflows/index';
import { transaction } from '#server/platform/definitions/define-store';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';
import { withTestPublication } from '#testing/publication';

for (const mode of ['history', 'delete'] as const)
  testStable(
    `raw exact authored citation blocks ${mode} after private capture retirement until its raw message is deleted`,
    async () => {
      const f = await documentTransformFixture();

      try {
        const saved = await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;
            const chats = yield* Conversations;
            const document = yield* docs.create({
              createKey: randomUUID(),
              title: 'Evidence',
              document: deletionDocument('Exact evidence'),
              inputs: [],
              citations: []
            });

            assert.ok(document.version);
            const input = { kind: 'document' as const, versionId: document.version.id };
            const session = yield* chats.createUntitledSession({});
            yield* docs.attach({ sessionId: session.id, documentId: document.id });

            yield* chats.updateSessionSelection({
              sessionId: session.id,
              expectedRevision: 0n,
              targets: [{ input, scope: { kind: 'document' } }]
            });
            const request = yield* chats.requestReply({ sessionId: session.id });
            const block = document.version.document.blocks[0]!;

            yield* withTestPublication(
              f.context,
              chats
                .publishReply({
                  requestId: request.requestId,
                  text: 'Exact answer [1]',
                  citations: [
                    {
                      marker: 1,
                      sourceId: null,
                      input,
                      documentId: document.version.snapshotId,
                      blockOrdinal: 0,
                      quote: block.text,
                      selectedRange: { blockId: block.id, start: 0, end: block.text.length }
                    }
                  ]
                })
                .pipe(Effect.asVoid)
            );
            // Model retained completed citations from a migrated capture whose private payload
            // has been retired. The native authority is fenced before releasing normalized pins.
            yield* transaction((tx) =>
              Workflows.retireCorrelations(
                tx,
                [request.requestId],
                ['ConversationGenerationRequested']
              )
            );
            f.context.db.orm.run(
              sql`DELETE FROM conversation_reply_requests WHERE request_id=${request.requestId}`
            );
            f.context.db.orm.run(
              sql`DELETE FROM session_run_contexts WHERE request_id=${request.requestId}`
            );
            assert.strictEqual(
              f.context.db.orm.get(sql`SELECT count(*) n FROM session_context_documents`)?.n,
              0n
            );
            assert.strictEqual(
              f.context.db.orm.get(sql`SELECT count(*) n FROM session_run_contexts`)?.n,
              0n
            );

            if (mode === 'history')
              yield* docs.save({
                documentId: document.id,
                expectedVersionId: document.version.id,
                key: 'advance',
                document: deletionDocument('Current evidence')
              });

            return {
              document: { ...document, version: document.version },
              messageId: request.messageId
            };
          }).pipe(Effect.provide(f.domain()))
        );

        f.reopen();
        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;
            const chats = yield* Conversations;
            const preview =
              mode === 'history'
                ? yield* docs.previewHistory({ documentId: saved.document.id, keepLatest: 1 })
                : yield* docs.previewDeletion({ id: saved.document.id });

            assert.ok(preview.blockedVersionIds.includes(saved.document.version.id));
            assert.throws(() =>
              f.context.db.orm.run(
                sql`INSERT INTO study_document_retirements(version_id,reason,created_at) VALUES(${saved.document.version.id},'history',1)`
              )
            );
            const raw = yield* chats.message(saved.messageId);

            assert.ok(raw.citations[0]?.evidence?.availability === 'available');
            yield* chats.deleteMessage(saved.messageId);
            const released =
              mode === 'history'
                ? yield* docs.previewHistory({ documentId: saved.document.id, keepLatest: 1 })
                : yield* docs.previewDeletion({ id: saved.document.id });

            expect(released.blockedVersionIds).toStrictEqual([]);

            if (mode === 'history')
              yield* docs.retireHistory({
                documentId: saved.document.id,
                keepLatest: 1,
                token: released.token
              });
            else yield* docs.delete({ documentId: saved.document.id, token: released.token });

            assert.ok(
              (yield* Effect.flip(docs.version({ id: saved.document.version.id }))).kind ===
                'not_found'
            );
          }).pipe(Effect.provide(f.domain()))
        );
        expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
      } finally {
        await f.close();
      }
    }
  );
