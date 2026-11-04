/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exact raw reply pins and private native checkpoints follow independent             │
 * │ source/authored and session lifetimes.                                                   │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies retained identities and exact input retirement invariants.                    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real service dependencies; never opens live user data. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import type { ContentInput } from '@study/contracts/inputs';
import { sql } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Effect, Schema } from 'effect';
import { Activity, DurableDeferred, WorkflowEngine } from 'effect/workflow';
import { assert, expect } from 'vite-plus/test';

import { Conversations } from '#server/features/conversations/index';
import {
  sessionDeletionWorkflow,
  sessionDeletionHandler
} from '#server/features/conversations/workflows/deletion';
import {
  conversationReplyWorkflow,
  conversationReplyHandler
} from '#server/features/conversations/workflows/index';
import { Documents } from '#server/features/documents/index';
import { Sources } from '#server/features/sources/index';
import { decodeEvent } from '#server/platform/workflows/events';
import { workflowStore } from '#server/platform/workflows/store';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument } from '#testing/material-deletion';
import { processSource } from '#testing/material-history';
import { withTestPublication } from '#testing/publication';
import { assertScrubbed, awaitNativeStatus, deletionEvent } from '#testing/session-deletion';

type Fixture = Awaited<ReturnType<typeof documentTransformFixture>>;

function replyEvent(f: Fixture, requestId: string) {
  const event = f.context.db.orm
    .select()
    .from(s.workflowEvents)
    .all()
    .filter((row) => row.payload !== '{}')
    .map((row) => decodeEvent(row.payload))
    .findLast(
      (event) => event.type === 'ConversationGenerationRequested' && event.requestId === requestId
    );

  assert.ok(event?.type === 'ConversationGenerationRequested');

  return event;
}

for (const kind of ['document', 'source'] as const)
  for (const second of [false, true])
    testStable(
      `${kind} exact reply ${second ? (kind === 'document' ? 'rewrite' : 'generated checkpoint') : 'pending capture'} protects history until explicit raw session cleanup`,
      async () => {
        const f = await documentTransformFixture();

        try {
          const evidence =
            kind === 'document'
              ? await Effect.runPromise(
                  Effect.flatMap(Documents, (docs) =>
                    docs.create({
                      createKey: randomUUID(),
                      title: 'Evidence',
                      document: deletionDocument('Historical exact evidence'),
                      inputs: [],
                      citations: []
                    })
                  ).pipe(Effect.provide(f.domain()))
                ).then((value) => {
                  assert.ok(value.version);

                  return {
                    input: { kind: 'document' as const, versionId: value.version.id },
                    document: value.version.document,
                    documentId: value.id,
                    snapshotId: value.version.snapshotId
                  };
                })
              : await (async () => {
                  const source = await Effect.runPromise(
                    Effect.flatMap(Sources, (sources) =>
                      sources.createSource({
                        name: 'attachment.txt',
                        bytes: new TextEncoder().encode('Historical exact evidence'),
                        projectId: null
                      })
                    ).pipe(Effect.provide(f.domain()))
                  );
                  const body = await processSource(f);

                  return Effect.runPromise(
                    Effect.flatMap(Sources, (sources) =>
                      sources.extraction({
                        sourceId: source.id,
                        revision: 1n,
                        snapshotId: body.documentId
                      })
                    ).pipe(Effect.provide(f.domain()))
                  ).then((value) => ({
                    input: {
                      kind: 'source' as const,
                      sourceId: source.id,
                      revision: 1n,
                      snapshotId: value.snapshotId
                    },
                    document: value.document,
                    documentId: undefined,
                    snapshotId: value.snapshotId
                  }));
                })();
          const input: ContentInput = evidence.input;
          const saved = await Effect.runPromise(
            Effect.gen(function* () {
              const chats = yield* Conversations;
              const session = yield* chats.createUntitledSession({});

              yield* chats.postMessage({
                sessionId: session.id,
                text: 'RAW_PRIVATE_QUESTION',
                requestReply: false,
                ...(input.kind === 'source' ? { sourceIds: [input.sourceId] } : {})
              });
              const other = yield* chats.createUntitledSession({});

              yield* chats.postMessage({
                sessionId: other.id,
                text: 'Unrelated raw note',
                requestReply: false
              });

              if (input.kind === 'document') {
                yield* (yield* Documents).attach({
                  sessionId: session.id,
                  documentId: evidence.documentId!
                });
                yield* chats.updateSessionSelection({
                  sessionId: session.id,
                  expectedRevision: 0n,
                  targets: [{ input, scope: { kind: 'document' } }]
                });
              }

              const completed = yield* chats.requestReply({
                sessionId: session.id,
                intentKey: 'completed'
              });
              const block = evidence.document.blocks[0]!;

              yield* withTestPublication(
                f.context,
                chats
                  .publishReply({
                    requestId: completed.requestId,
                    text: 'Intentionally completed answer [1]',
                    citations: [
                      {
                        marker: 1,
                        sourceId: input.kind === 'source' ? input.sourceId : null,
                        input,
                        documentId: evidence.snapshotId,
                        blockOrdinal: 0,
                        quote: block.text,
                        ...(input.kind === 'document'
                          ? {
                              selectedRange: {
                                blockId: block.id,
                                start: 0,
                                end: block.text.length
                              }
                            }
                          : {})
                      }
                    ]
                  })
                  .pipe(Effect.asVoid)
              );
              const published = yield* chats.message(completed.messageId);
              const pending =
                kind === 'document' && second
                  ? yield* chats.rewriteMessage({
                      messageId: completed.messageId,
                      origin: 'instruction',
                      instruction: 'PRIVATE_UNFINISHED_REPLY'
                    })
                  : yield* chats.requestReply({
                      sessionId: session.id,
                      intentKey: 'pending',
                      instruction: 'PRIVATE_UNFINISHED_REPLY'
                    });
              const unrelated = yield* chats.requestReply({
                sessionId: other.id,
                intentKey: 'independent'
              });
              const unrelatedSnapshot = yield* chats.replySnapshot({
                requestId: unrelated.requestId
              });
              const otherThread = yield* chats.thread({ sessionId: other.id, limit: 20 });

              return {
                session,
                other,
                completed,
                published,
                pending,
                unrelated,
                unrelatedSnapshot,
                otherThread
              };
            }).pipe(Effect.provide(f.domain()))
          );
          const event = replyEvent(f, saved.pending.requestId);
          const otherEvent = replyEvent(f, saved.unrelated.requestId);
          const checkpoint = kind === 'source' && second;

          if (checkpoint) {
            f.context.db.exec(
              "CREATE TRIGGER reject_reply_publication BEFORE UPDATE OF status ON message_versions WHEN NEW.status='complete' BEGIN SELECT RAISE(ABORT,'injected publication gap'); END"
            );
            f.replies.push(
              { kind: 'sources', query: 'Historical exact' },
              { kind: 'output', output: 'PRIVATE_REPLY_CHECKPOINT [1]' }
            );
            await expect(
              Effect.runPromise(
                Effect.scoped(
                  Effect.gen(function* () {
                    const engine = yield* WorkflowEngine.WorkflowEngine;

                    yield* engine.register(conversationReplyWorkflow, conversationReplyHandler);
                    yield* engine.execute(conversationReplyWorkflow, {
                      executionId: 'checkpoint-reply',
                      payload: { event }
                    });
                  })
                ).pipe(Effect.provide(f.services()))
              )
            ).rejects.toSatisfy(() => true);
            assert.ok(
              workflowStore(f.context)
                .activity('checkpoint-reply', 'generate-reply', 1)
                ?.includes('PRIVATE_REPLY_CHECKPOINT')
            );
            f.context.db.exec('DROP TRIGGER reject_reply_publication');
          }

          if (input.kind === 'document')
            await Effect.runPromise(
              Effect.gen(function* () {
                const docs = yield* Documents;
                const old = yield* docs.version({ id: input.versionId });

                yield* docs.save({
                  documentId: old.documentId,
                  expectedVersionId: old.id,
                  key: 'advance',
                  document: deletionDocument('Current exact evidence')
                });
                const preview = yield* docs.previewHistory({
                  documentId: old.documentId,
                  keepLatest: 1
                });

                assert.ok(preview.blockedVersionIds.includes(old.id));
              }).pipe(Effect.provide(f.domain()))
            );
          else {
            await Effect.runPromise(
              Effect.flatMap(Sources, (sources) =>
                sources.replaceSource({
                  id: input.sourceId,
                  expectedRevision: 1,
                  name: 'current.txt',
                  bytes: new TextEncoder().encode('Current exact evidence')
                })
              ).pipe(Effect.provide(f.domain()))
            );
            await processSource(f);
            await Effect.runPromise(
              Effect.gen(function* () {
                const sources = yield* Sources;
                const preview = yield* sources.previewHistory({
                  sourceId: input.sourceId,
                  keepLatest: 1
                });

                assert.ok(preview.blockedSnapshotIds.includes(input.snapshotId));
                assert.ok(
                  (yield* Effect.flip(
                    sources.retireHistory({
                      sourceId: input.sourceId,
                      keepLatest: 1,
                      token: preview.token
                    })
                  )).kind === 'invalid_input'
                );
              }).pipe(Effect.provide(f.domain()))
            );
          }

          await Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const engine = yield* WorkflowEngine.WorkflowEngine;
                const chats = yield* Conversations;
                const gate = DurableDeferred.make('retired-reply');
                const otherGate = DurableDeferred.make('independent-reply');

                function suspendedReply({
                  event: run
                }: typeof conversationReplyWorkflow.payloadSchema.Type) {
                  return Effect.gen(function* () {
                    if (run.requestId === saved.pending.requestId) {
                      yield* Activity.make({
                        name: 'private-pending-reply',
                        success: Schema.String,
                        execute: Effect.succeed('PRIVATE_SUSPENDED_REPLY')
                      });
                      yield* DurableDeferred.await(gate);
                    } else yield* DurableDeferred.await(otherGate);

                    return run.versionId;
                  });
                }

                yield* engine.register(conversationReplyWorkflow, suspendedReply);
                yield* engine.register(sessionDeletionWorkflow, sessionDeletionHandler);

                if (!checkpoint)
                  yield* engine.execute(conversationReplyWorkflow, {
                    executionId: 'pending-reply',
                    payload: { event },
                    discard: true
                  });

                yield* engine.execute(conversationReplyWorkflow, {
                  executionId: 'independent-reply',
                  payload: { event: otherEvent },
                  discard: true
                });

                if (!checkpoint) yield* awaitNativeStatus(f, 'pending-reply', 'suspended');

                yield* awaitNativeStatus(f, 'independent-reply', 'suspended');
                const before = yield* chats.messageVersionCitations({
                  sessionId: saved.session.id,
                  messageId: saved.completed.messageId,
                  versionId: saved.completed.versionId
                });

                assert.ok(before.citations[0]?.evidence?.availability === 'available');
                yield* chats.deleteSession(saved.session.id);
                yield* engine.execute(sessionDeletionWorkflow, {
                  executionId: 'raw-input-cleanup',
                  payload: { event: deletionEvent(f, saved.session.id) }
                });

                if (!checkpoint)
                  assert.ok(
                    workflowStore(f.context).execution('pending-reply')?.status === 'cancelled'
                  );

                assert.ok(
                  workflowStore(f.context).execution('independent-reply')?.status === 'suspended'
                );
                assert.ok((yield* chats.sessionDeletion(saved.session.id)).status === 'completed');
              })
            ).pipe(Effect.provide(f.services()))
          );
          f.reopen();
          await Effect.runPromise(
            Effect.gen(function* () {
              const chats = yield* Conversations;

              assert.ok(
                (yield* Effect.flip(chats.message(saved.completed.messageId))).kind === 'not_found'
              );
              assert.ok(
                (yield* Effect.flip(chats.replySnapshot({ requestId: saved.pending.requestId })))
                  .kind === 'not_found'
              );
              expect(
                yield* chats.replySnapshot({ requestId: saved.unrelated.requestId })
              ).toStrictEqual(saved.unrelatedSnapshot);
              expect(yield* chats.thread({ sessionId: saved.other.id, limit: 20 })).toStrictEqual(
                saved.otherThread
              );

              if (input.kind === 'document') {
                const docs = yield* Documents;
                const old = yield* docs.version({ id: input.versionId });
                const scope = { documentId: old.documentId, keepLatest: 1 };
                const preview = yield* docs.previewHistory(scope);

                expect(preview.blockedVersionIds).toStrictEqual([]);
                yield* docs.retireHistory({ ...scope, token: preview.token });
                assert.ok(
                  (yield* docs.document({ id: old.documentId })).version?.document.blocks[0]
                    ?.text === 'Current exact evidence'
                );
              } else {
                const sources = yield* Sources;
                const scope = { sourceId: input.sourceId, keepLatest: 1 };
                const preview = yield* sources.previewHistory(scope);

                expect(preview.blockedSnapshotIds).toStrictEqual([]);
                yield* sources.retireHistory({ ...scope, token: preview.token });
                assert.ok(
                  (yield* sources.currentExtraction({ id: input.sourceId }))?.document.blocks[0]
                    ?.text === 'Current exact evidence'
                );
                expect(
                  (yield* sources.exportRevision({ sourceId: input.sourceId, revision: 1n })).bytes
                ).toStrictEqual(new TextEncoder().encode('Historical exact evidence'));
              }
            }).pipe(Effect.provide(f.domain()))
          );
          assertScrubbed(f, 'RAW_PRIVATE_QUESTION');
          assertScrubbed(f, 'PRIVATE_UNFINISHED_REPLY');
          assertScrubbed(f, 'PRIVATE_SUSPENDED_REPLY');
          assertScrubbed(f, 'PRIVATE_REPLY_CHECKPOINT');
          const calls = f.bodies.length;

          await expect(
            Effect.runPromise(
              Effect.scoped(
                Effect.gen(function* () {
                  const engine = yield* WorkflowEngine.WorkflowEngine;

                  yield* engine.register(conversationReplyWorkflow, conversationReplyHandler);
                  yield* engine.execute(conversationReplyWorkflow, {
                    executionId: 'late-private-reply',
                    payload: { event }
                  });
                })
              ).pipe(Effect.provide(f.services()))
            )
          ).rejects.toSatisfy(() => true);
          assert.strictEqual(f.bodies.length, calls);
          expect(f.context.db.orm.all(sql`PRAGMA foreign_key_check`)).toStrictEqual([]);
        } finally {
          await f.close();
        }
      }
    );
