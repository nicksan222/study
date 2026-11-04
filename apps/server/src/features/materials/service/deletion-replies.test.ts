/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises pending reply retirement without losing published conversation history.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves completed versions and citations while retiring private native checkpoints.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Migrated SQLite and native Workflows retain production ownership and publication guards. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';

import { eq } from '@study/db';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/node';
import { Effect, Exit, Schema } from 'effect';
import { Activity, DurableDeferred, WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import { conversationReplyWorkflow } from '#server/features/conversations/workflows/index';
import { Materials } from '#server/features/materials/index';
import {
  materialDeletionWorkflow,
  materialDeletionHandler
} from '#server/features/materials/workflows/deletion';
import { decodeEvent } from '#server/platform/workflows/events';
import { workflowStore } from '#server/platform/workflows/store';
import { documentTransformFixture } from '#testing/document-transform';
import { deletionDocument, materialDeletionEvent } from '#testing/material-deletion';
import type { MaterialDeletionFixture } from '#testing/material-deletion';
import { withTestPublication } from '#testing/publication';
import { assertScrubbed, awaitNativeStatus } from '#testing/session-deletion';

async function pendingReply(f: MaterialDeletionFixture, rewrite: boolean) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const c = yield* Conversations;

      const library = yield* (yield* Materials).createManualDocument({
        title: 'Reply evidence',
        document: deletionDocument('Published exact evidence')
      });

      const session = yield* c.createUntitledSession({});

      const other = yield* c.createUntitledSession({});

      yield* c.postMessage({
        sessionId: session.id,
        text: 'Keep this question',
        requestReply: false
      });

      yield* c.postMessage({
        sessionId: other.id,
        text: 'Unrelated question',
        requestReply: false
      });

      yield* c.updateSessionSelection({
        sessionId: session.id,
        expectedRevision: 0n,
        targets: [{ versionId: library.version.id, scope: { kind: 'document' } }]
      });

      const completed = yield* c.requestReply({
        sessionId: session.id,
        intentKey: 'published-copy'
      });

      const snapshot = yield* c.replySnapshot({ requestId: completed.requestId });

      const selected = snapshot.context?.inputs[0];

      assert.ok(selected?.documentId);

      const excerpt = selected.excerpts[0];

      assert.ok(excerpt);

      const publication = {
        requestId: completed.requestId,
        text: 'Intentionally published copy [1]',
        citations: [
          {
            marker: 1,
            sourceId: null,
            materialVersionId: library.version.id,
            documentId: selected.documentId,
            blockOrdinal: 0,
            selectedRange: {
              versionId: selected.versionId,
              documentId: selected.documentId,
              blockId: excerpt.blockId,
              start: excerpt.start,
              end: excerpt.end
            },
            quote: 'Published exact evidence'
          }
        ]
      };

      yield* withTestPublication(f.context, c.publishReply(publication).pipe(Effect.asVoid));

      if (rewrite) {
        const second = yield* c.reanswer({ messageId: completed.messageId });

        yield* withTestPublication(
          f.context,
          c
            .publishReply({
              ...publication,
              requestId: second.requestId,
              text: 'Second complete answer [1]'
            })
            .pipe(Effect.asVoid)
        );
      }

      const before = yield* c.message(completed.messageId);

      const pending = rewrite
        ? yield* c.rewriteMessage({
            messageId: completed.messageId,
            origin: 'instruction',
            instruction: 'PRIVATE_UNFINISHED_REWRITE_ONLY'
          })
        : yield* c.requestReply({
            sessionId: session.id,
            intentKey: 'initial-pending',
            instruction: 'PRIVATE_UNFINISHED_INITIAL_ONLY'
          });

      const unrelated = yield* c.requestReply({
        sessionId: other.id,
        intentKey: 'unrelated-pending'
      });

      const otherSnapshot = yield* c.replySnapshot({ requestId: unrelated.requestId });

      const otherThread = yield* c.thread({ sessionId: other.id, limit: 20 });

      return {
        library,
        session,
        completed,
        before,
        pending,
        unrelated,
        otherSnapshot,
        otherThread
      };
    }).pipe(Effect.provide(f.domain()))
  );
}

for (const rewrite of [false, true]) {
  testStable(
    `Material cleanup retires a suspended ${rewrite ? 'instruction rewrite' : 'initial reply'} and leaves the session usable`,
    async () => {
      const f = await documentTransformFixture();

      try {
        const saved = await pendingReply(f, rewrite);

        const citations = f.context.db.orm.select().from(s.citations).all();

        const events = f.context.db.orm
          .select()
          .from(s.workflowEvents)
          .where(eq(s.workflowEvents.type, 'ConversationGenerationRequested'))
          .all()
          .map((row) => decodeEvent(row.payload));

        const affected = events.find(
          (event) =>
            event.type === 'ConversationGenerationRequested' &&
            event.requestId === saved.pending.requestId
        );

        const unrelated = events.find(
          (event) =>
            event.type === 'ConversationGenerationRequested' &&
            event.requestId === saved.unrelated.requestId
        );

        assert.ok(affected?.type === 'ConversationGenerationRequested');

        assert.ok(unrelated?.type === 'ConversationGenerationRequested');

        const gate = DurableDeferred.make('affected-reply-gate');

        const otherGate = DurableDeferred.make('unrelated-reply-gate');

        const pausedReply = ({ event }: typeof conversationReplyWorkflow.payloadSchema.Type) =>
          Effect.gen(function* () {
            if (event.requestId === saved.pending.requestId) {
              yield* Activity.make({
                name: 'private-reply-checkpoint',
                success: Schema.String,
                execute: Effect.succeed('PRIVATE_REPLY_CHECKPOINT_ONLY')
              });

              yield* DurableDeferred.await(gate);
            } else yield* DurableDeferred.await(otherGate);

            return event.versionId;
          });

        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const engine = yield* WorkflowEngine.WorkflowEngine;

              const m = yield* Materials;

              yield* engine.register(conversationReplyWorkflow, pausedReply);

              yield* engine.register(materialDeletionWorkflow, materialDeletionHandler);

              yield* engine.execute(conversationReplyWorkflow, {
                executionId: 'affected-reply',
                payload: { event: affected },
                discard: true
              });

              yield* engine.execute(conversationReplyWorkflow, {
                executionId: 'unrelated-reply',
                payload: { event: unrelated },
                discard: true
              });

              yield* awaitNativeStatus(f, 'affected-reply', 'suspended');

              yield* awaitNativeStatus(f, 'unrelated-reply', 'suspended');

              const preview = yield* m.previewDeletion({ materialId: saved.library.id });

              yield* m.requestDeletion({
                materialId: saved.library.id,
                descendantIds: [],
                token: preview.token
              });

              yield* engine.execute(materialDeletionWorkflow, {
                executionId: 'reply-cleanup',
                payload: { event: materialDeletionEvent(f, saved.library.id) }
              });

              yield* awaitNativeStatus(f, 'affected-reply', 'cancelled');

              assert.equal(
                workflowStore(f.context).execution('unrelated-reply')?.status,
                'suspended'
              );

              yield* engine.deferredDone(gate, {
                workflowName: conversationReplyWorkflow._tag,
                executionId: 'affected-reply',
                deferredName: gate.name,
                exit: Exit.void
              });

              assert.equal(
                workflowStore(f.context).deferred('affected-reply', gate.name),
                undefined
              );

              assert.equal(
                (yield* m.deletion({ materialId: saved.library.id })).status,
                'completed'
              );
            }).pipe(Effect.provide(f.services()))
          )
        );

        assert.equal(
          f.context.db.orm
            .select()
            .from(s.message_versions)
            .where(eq(s.message_versions.id, saved.pending.versionId))
            .get(),
          undefined
        );

        assert.equal(
          f.context.db.orm
            .select()
            .from(s.conversation_reply_requests)
            .where(eq(s.conversation_reply_requests.request_id, saved.pending.requestId))
            .get(),
          undefined
        );

        if (!rewrite)
          assert.equal(
            f.context.db.orm
              .select()
              .from(s.messages)
              .where(eq(s.messages.id, saved.pending.messageId))
              .get(),
            undefined
          );

        assert.deepEqual(
          f.context.db.orm.select().from(s.citations).all(),
          citations.map((citation) => ({ ...citation, document_id: null }))
        );

        assertScrubbed(
          f,
          rewrite ? 'PRIVATE_UNFINISHED_REWRITE_ONLY' : 'PRIVATE_UNFINISHED_INITIAL_ONLY'
        );

        assertScrubbed(f, 'PRIVATE_REPLY_CHECKPOINT_ONLY');

        f.reopen();

        await Effect.runPromise(
          Effect.gen(function* () {
            const c = yield* Conversations;

            const message = yield* c.message(saved.completed.messageId);

            assert.equal(message.activeVersionId, saved.before.activeVersionId);

            assert.deepEqual(message.versions, saved.before.versions);

            assert.equal(message.citations[0]?.quote, 'Published exact evidence');

            assert.equal(message.citations[0]?.materialVersionId, saved.library.version.id);

            assert.equal(message.citations[0]?.evidence?.availability, 'unavailable');

            assert.deepEqual(
              yield* c.replySnapshot({ requestId: saved.unrelated.requestId }),
              saved.otherSnapshot
            );

            assert.deepEqual(
              yield* c.thread({ sessionId: saved.unrelated.sessionId, limit: 20 }),
              saved.otherThread
            );

            yield* c.postMessage({
              sessionId: saved.session.id,
              text: 'Continue after cleanup',
              requestReply: false
            });

            const next = yield* c.requestReply({
              sessionId: saved.session.id,
              intentKey: 'after-cleanup'
            });

            assert.notEqual(next.versionId, saved.pending.versionId);

            assert.equal(
              (yield* c.replySnapshot({ requestId: next.requestId })).context?.inputs.length,
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
