/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises atomic Ask receipts and exact version recovery against real SQLite.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Covers selection races, ambiguous submission replay and transaction rollback.          │
 * │ - Preserves exact generated identities across reopen, rewrite and native cleanup.        │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses public services and native RPC with temporary databases and controlled publication. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { RpcTest } from 'effect/rpc';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import { ConversationsRpcLive } from '#server/features/conversations/rpc/index';
import { Documents } from '#server/features/documents/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';
import { withTestPublication } from '#testing/publication';
import { cleanup } from '#testing/session-deletion';

// No workers or providers are started: publication is controlled through the existing test fence.
testStable(
  'Ask fences stale windows, replays full intent once, rolls back outbox failure and reopens exact versions',
  async () => {
    const location = createTestDatabase();
    let context = new ServerContext(location.open());
    const handlers = () =>
      ConversationsRpcLive.pipe(
        Layer.provideMerge(
          Layer.mergeAll(Conversations.layer, Documents.layer, Settings.layer, Sources.layer)
        ),
        Layer.provideMerge(Layer.succeed(Database, { store: context }))
      );

    try {
      const saved = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });
            const c = yield* Conversations;
            const documents = yield* Documents;
            const session = yield* rpc('conversations.createSession', { title: 'Ask' });
            const other = yield* rpc('conversations.createSession', { title: 'Other' });
            const material = yield* documents.create({
              title: 'Exact input',
              document: deletionDocument('Selected evidence'),
              createKey: randomUUID(),
              inputs: [],
              citations: []
            });

            yield* rpc('conversations.updateSessionSelection', {
              sessionId: session.id,
              expectedRevision: 0n,
              targets: [
                {
                  input: { kind: 'document', versionId: material.version!.id },
                  scope: { kind: 'document' }
                }
              ]
            });
            const source = yield* (yield* Sources).createSource({
              projectId: null,
              name: 'question.txt',
              bytes: new TextEncoder().encode('Attachment')
            });
            const root = yield* rpc('conversations.postMessage', {
              sessionId: other.id,
              text: 'Thread root',
              sourceIds: [source.id],
              requestReply: false
            });
            const input = {
              sessionId: session.id,
              intentKey: 'ask-one',
              expectedSelectionRevision: 1n,
              text: '  Explain this  ',
              instruction: 'Use the selected input',
              preferences: { detail: 'brief' as const }
            };
            const counts = () =>
              [
                s.messages,
                s.message_versions,
                s.session_run_contexts,
                s.conversation_reply_requests,
                s.workflowEvents
              ].map((table) => context.db.orm.select().from(table).all().length);
            const empty = counts();

            assert.ok(
              (yield* Effect.flip(
                rpc('conversations.ask', { ...input, expectedSelectionRevision: 0n })
              )).kind === 'invalid_input'
            );
            expect(counts()).toStrictEqual(empty);

            // Abort at the final outbox insert, after note, capture and pending reply writes.
            context.db.orm.run(
              sql`CREATE TRIGGER reject_ask_outbox BEFORE INSERT ON workflow_events WHEN NEW.type='ConversationGenerationRequested' BEGIN SELECT RAISE(ABORT,'injected Ask commit failure'); END`
            );
            yield* Effect.flip(rpc('conversations.ask', input));
            expect(counts()).toStrictEqual(empty);
            context.db.orm.run(sql`DROP TRIGGER reject_ask_outbox`);
            // An uncommitted key still has to match the displayed selection revision.
            yield* rpc('conversations.updateSessionSelection', {
              sessionId: session.id,
              expectedRevision: 1n,
              targets: []
            });
            assert.ok(
              (yield* Effect.flip(rpc('conversations.ask', input))).kind === 'invalid_input'
            );
            expect(counts()).toStrictEqual(empty);
            const submitted = { ...input, expectedSelectionRevision: 2n };
            const duplicates = yield* Effect.all(
              [rpc('conversations.ask', submitted), rpc('conversations.ask', submitted)],
              { concurrency: 2 }
            );
            const result = duplicates[0]!;

            expect(duplicates[1]).toStrictEqual(result);
            expect(counts().map((n, i) => n - empty[i]!)).toStrictEqual([2, 2, 1, 1, 1]);
            const captured = yield* rpc('conversations.inspectSessionContext', {
              requestId: result.requestId
            });

            assert.strictEqual(captured.throughMessageId, result.userMessageId);
            assert.strictEqual(captured.messages.at(-1)?.versionId, result.userVersionId);
            assert.ok(captured.messages.at(-1)?.text === 'Explain this');
            assert.strictEqual(
              (yield* rpc('conversations.message', { id: result.messageId })).replyTo,
              result.userMessageId
            );

            for (const changed of [
              { ...submitted, text: 'Different' },
              { ...submitted, expectedSelectionRevision: 1n },
              { ...submitted, instruction: 'Different' },
              { ...submitted, preferences: { detail: 'detailed' as const } },
              { ...submitted, sourceIds: [source.id] },
              { ...submitted, threadRoot: root.parts[0]!.id }
            ])
              assert.ok(
                (yield* Effect.flip(rpc('conversations.ask', changed))).kind === 'invalid_input'
              );

            assert.ok(
              (yield* Effect.flip(
                rpc('conversations.requestReply', {
                  sessionId: session.id,
                  intentKey: submitted.intentKey
                })
              )).kind === 'invalid_input'
            );
            yield* withTestPublication(
              context,
              c
                .publishReply({ requestId: result.requestId, text: 'First answer', citations: [] })
                .pipe(Effect.asVoid)
            );
            yield* rpc('conversations.postMessage', {
              sessionId: session.id,
              text: 'A later note',
              requestReply: false
            });
            yield* rpc('conversations.updateSessionSelection', {
              sessionId: session.id,
              expectedRevision: 2n,
              targets: [
                {
                  input: { kind: 'document', versionId: material.version!.id },
                  scope: { kind: 'document' }
                }
              ]
            });
            expect(
              yield* rpc('conversations.ask', {
                ...submitted,
                text: 'Explain this',
                sourceIds: []
              })
            ).toStrictEqual(result);
            expect(
              yield* rpc('conversations.inspectSessionContext', { requestId: result.requestId })
            ).toStrictEqual(captured);
            // Replay must retain the captured user version even after its note is edited.
            const editedNote = yield* rpc('conversations.editMessage', {
              messageId: result.userMessageId,
              text: 'Edited after capture'
            });

            assert.notStrictEqual(editedNote.activeVersionId, result.userVersionId);
            expect(yield* rpc('conversations.ask', submitted)).toStrictEqual(result);
            expect(
              yield* rpc('conversations.inspectSessionContext', { requestId: result.requestId })
            ).toStrictEqual(captured);
            const rewrite = yield* rpc('conversations.rewriteMessage', {
              messageId: result.messageId,
              origin: 'improve'
            });

            yield* withTestPublication(
              context,
              c
                .publishReply({
                  requestId: rewrite.requestId,
                  text: 'Rewritten answer',
                  citations: []
                })
                .pipe(Effect.asVoid)
            );
            const reanswer = yield* rpc('conversations.reanswer', { messageId: result.messageId });

            yield* withTestPublication(
              context,
              c
                .publishReply({ requestId: reanswer.requestId, text: 'Reanswered', citations: [] })
                .pipe(Effect.asVoid)
            );
            const edited = yield* rpc('conversations.editMessage', {
              messageId: result.messageId,
              text: 'Manual answer'
            });
            const key = {
              sessionId: session.id,
              messageId: result.messageId,
              versionId: result.versionId
            };

            expect(yield* rpc('conversations.replyVersion', key)).toStrictEqual({
              state: 'available',
              requestId: result.requestId
            });
            expect(
              yield* rpc('conversations.replyVersion', { ...key, versionId: rewrite.versionId })
            ).toStrictEqual({ state: 'available', requestId: rewrite.requestId });
            expect(
              yield* rpc('conversations.replyVersion', { ...key, versionId: reanswer.versionId })
            ).toStrictEqual({ state: 'available', requestId: reanswer.requestId });
            expect(
              yield* rpc('conversations.replyVersion', {
                ...key,
                versionId: edited.activeVersionId!
              })
            ).toStrictEqual({ state: 'manual' });
            assert.ok(
              (yield* Effect.flip(
                rpc('conversations.replyVersion', { ...key, sessionId: other.id })
              )).kind === 'not_found'
            );
            assert.ok(
              (yield* Effect.flip(
                rpc('conversations.replyVersion', { ...key, versionId: result.userVersionId })
              )).kind === 'not_found'
            );
            const attachmentInput = {
              sessionId: other.id,
              threadRoot: root.parts[0]!.id,
              intentKey: 'thread-attachment',
              expectedSelectionRevision: 0n,
              text: '',
              sourceIds: [source.id]
            };
            const threaded = yield* rpc('conversations.ask', attachmentInput);
            const attached = yield* rpc('conversations.message', { id: threaded.userMessageId });

            assert.strictEqual(attached.threadRoot, root.parts[0]!.id);
            assert.strictEqual(attached.parts[0]?.sourceId, source.id);
            const attachmentSnapshot = yield* rpc('conversations.replySnapshot', {
              requestId: threaded.requestId
            });

            assert.ok(
              attachmentSnapshot.pendingAttachments?.some(
                (part) => part.sourceId === source.id && part.messageId === threaded.userMessageId
              )
            );
            assert.strictEqual(
              attachmentSnapshot.context?.messages.at(-1)?.versionId,
              threaded.userVersionId
            );
            const movedProject = context.db.orm
              .insert(s.projects)
              .values({
                name: 'Later organization',
                created_at: 1n,
                updated_at: 1n
              })
              .returning()
              .get();

            yield* (yield* Sources).setSourceProject({ id: source.id, projectId: movedProject.id });
            expect(yield* rpc('conversations.ask', attachmentInput)).toStrictEqual(threaded);
            expect(
              yield* rpc('conversations.replyVersion', {
                sessionId: other.id,
                messageId: threaded.messageId,
                versionId: threaded.versionId
              })
            ).toStrictEqual({ state: 'available', requestId: threaded.requestId });

            return {
              submitted,
              result,
              captured,
              key,
              rewrite,
              reanswer,
              manualVersionId: edited.activeVersionId!
            };
          }).pipe(Effect.provide(handlers()))
        )
      );

      context.close();
      context = new ServerContext(location.open());
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const rpc = yield* RpcTest.makeClient(ConversationsRpc, { flatten: true });

            expect(yield* rpc('conversations.ask', saved.submitted)).toStrictEqual(saved.result);
            expect(
              yield* rpc('conversations.inspectSessionContext', {
                requestId: saved.result.requestId
              })
            ).toStrictEqual(saved.captured);
            expect(yield* rpc('conversations.replyVersion', saved.key)).toStrictEqual({
              state: 'available',
              requestId: saved.result.requestId
            });
            expect(
              yield* rpc('conversations.replyVersion', {
                ...saved.key,
                versionId: saved.rewrite.versionId
              })
            ).toStrictEqual({ state: 'available', requestId: saved.rewrite.requestId });
            expect(
              yield* rpc('conversations.replyVersion', {
                ...saved.key,
                versionId: saved.reanswer.versionId
              })
            ).toStrictEqual({ state: 'available', requestId: saved.reanswer.requestId });
            expect(
              yield* rpc('conversations.replyVersion', {
                ...saved.key,
                versionId: saved.manualVersionId
              })
            ).toStrictEqual({ state: 'manual' });
          }).pipe(Effect.provide(handlers()))
        )
      );
    } finally {
      context.close();
      location.cleanup();
    }
  }
);

testStable(
  'Ask binds ordered attachments to its intent and rejects changed order without writes',
  async () => {
    const f = await documentTransformFixture();

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;
          const sources = yield* Sources;
          const session = yield* c.createUntitledSession({});
          const first = yield* sources.createSource({
            projectId: null,
            name: 'first.txt',
            bytes: new TextEncoder().encode('First attachment')
          });
          const second = yield* sources.createSource({
            projectId: null,
            name: 'second.txt',
            bytes: new TextEncoder().encode('Second attachment')
          });
          const input = {
            sessionId: session.id,
            intentKey: 'ordered-attachments',
            expectedSelectionRevision: 0n,
            text: 'Compare these',
            sourceIds: [first.id, second.id]
          };
          const result = yield* c.ask(input);
          const note = yield* c.message(result.userMessageId);

          expect(note.parts.map((part) => part.sourceId)).toStrictEqual([first.id, second.id]);
          const counts = () => [
            f.context.db.orm.select().from(s.messages).all().length,
            f.context.db.orm.select().from(s.session_run_contexts).all().length,
            f.context.db.orm.select().from(s.conversation_reply_requests).all().length,
            f.context.db.orm.select().from(s.workflowEvents).all().length
          ];
          const committed = counts();

          assert.ok(
            (yield* Effect.flip(c.ask({ ...input, sourceIds: [second.id, first.id] }))).kind ===
              'invalid_input'
          );
          expect(counts()).toStrictEqual(committed);
          expect(yield* c.ask(input)).toStrictEqual(result);
          expect(counts()).toStrictEqual(committed);
        }).pipe(Effect.provide(f.domain()))
      );
    } finally {
      await f.close();
    }
  }
);

for (const mode of ['history', 'material', 'session'] as const) {
  testStable(
    `Ask cannot resurrect after session cleanup and exact pins protect ${mode} retirement`,
    async () => {
      const f = await documentTransformFixture();

      try {
        const saved = await Effect.runPromise(
          Effect.gen(function* () {
            const c = yield* Conversations;
            const documents = yield* Documents;
            const material = yield* documents.create({
              title: 'Cleanup',
              document: deletionDocument('Private captured input'),
              createKey: randomUUID(),
              inputs: [],
              citations: []
            });
            const session = yield* c.createUntitledSession({});

            yield* c.updateSessionSelection({
              sessionId: session.id,
              expectedRevision: 0n,
              targets: [
                {
                  input: { kind: 'document', versionId: material.version!.id },
                  scope: { kind: 'document' }
                }
              ]
            });
            const input = {
              sessionId: session.id,
              intentKey: 'cleanup-ask',
              expectedSelectionRevision: 1n,
              text: 'Keep independent note',
              instruction: 'PRIVATE_ASK_INSTRUCTION'
            };
            const result = yield* c.ask(input);
            const captured = yield* c.inspectSessionContext({ requestId: result.requestId });

            assert.strictEqual(captured.selectionRevision, 1n);
            expect(captured.inputs[0]?.input).toStrictEqual({
              kind: 'document',
              versionId: material.version!.id
            });
            assert.strictEqual(captured.messages.at(-1)?.versionId, result.userVersionId);
            yield* withTestPublication(
              f.context,
              c
                .publishReply({
                  requestId: result.requestId,
                  text: 'Independent answer',
                  citations: []
                })
                .pipe(Effect.asVoid)
            );
            const manual = yield* c.editMessage({
              messageId: result.messageId,
              text: 'A later manual version must not supply provenance for the retired answer'
            });

            if (mode === 'history')
              yield* documents.save({
                documentId: material.id,
                expectedVersionId: material.version!.id,
                key: randomUUID(),
                document: deletionDocument('New head')
              });

            return { input, result, material, session, manualVersionId: manual.activeVersionId! };
          }).pipe(Effect.provide(f.domain()))
        );

        await Effect.runPromise(
          Effect.gen(function* () {
            const docs = yield* Documents;

            if (mode === 'history') {
              const preview = yield* docs.previewHistory({
                documentId: saved.material.id,
                keepLatest: 1
              });

              assert.ok(preview.blockedVersionIds.includes(saved.material.version!.id));
              assert.ok(
                (yield* Effect.flip(
                  docs.retireHistory({
                    documentId: saved.material.id,
                    keepLatest: 1,
                    token: preview.token
                  })
                )).kind === 'invalid_input'
              );
            } else if (mode === 'material') {
              const preview = yield* docs.previewDeletion({ id: saved.material.id });

              assert.ok(preview.blockedVersionIds.includes(saved.material.version!.id));
              assert.ok(
                (yield* Effect.flip(
                  docs.delete({ documentId: saved.material.id, token: preview.token })
                )).kind === 'invalid_input'
              );
            }

            const chats = yield* Conversations;

            expect(yield* chats.ask(saved.input)).toStrictEqual(saved.result);
            yield* chats.deleteSession(saved.session.id);
          }).pipe(Effect.provide(f.domain()))
        );
        await cleanup(f, saved.session.id);

        await Effect.runPromise(
          Effect.gen(function* () {
            const c = yield* Conversations;
            const count = f.context.db.orm.select().from(s.messages).all().length;

            assert.ok((yield* Effect.flip(c.ask(saved.input))).kind === 'not_found');
            assert.strictEqual(f.context.db.orm.select().from(s.messages).all().length, count);
            const key = {
              sessionId: saved.session.id,
              messageId: saved.result.messageId,
              versionId: saved.result.versionId
            };

            assert.ok((yield* Effect.flip(c.replyVersion(key))).kind === 'not_found');
            const docs = yield* Documents;

            assert.strictEqual(
              (yield* docs.document({ id: saved.material.id })).id,
              saved.material.id
            );
            assert.strictEqual(
              f.context.db.orm
                .select()
                .from(s.session_run_contexts)
                .where(eq(s.session_run_contexts.request_id, saved.result.requestId))
                .all().length,
              0
            );
          }).pipe(Effect.provide(f.domain()))
        );
      } finally {
        await f.close();
      }
    }
  );
}
