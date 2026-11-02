/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises attachment-only historical reply retirement and native replay fences.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Covers empty selection captures, generated checkpoints and independent message copies. │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Canonical reply snapshots, source processing and real native Activities own persistence. │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Effect, Exit } from 'effect';
import { DurableDeferred, WorkflowEngine } from 'effect/workflow';

import { Conversations } from '#server/features/conversations/index';
import {
  conversationReplyWorkflow,
  conversationReplyHandler
} from '#server/features/conversations/workflows/index';
import { Materials } from '#server/features/materials/index';
import {
  materialHistoryWorkflow,
  materialHistoryHandler
} from '#server/features/materials/workflows/history';
import { Sources } from '#server/features/sources/index';
import { emitEvent, decodeEvent } from '#server/platform/workflows/events';
import { workflowStore } from '#server/platform/workflows/store';
import { documentTransformFixture } from '#testing/document-transform';
import {
  historyEvent,
  processSource,
  acceptHistory,
  cleanupHistory
} from '#testing/material-history';
import { withTestPublication } from '#testing/publication';
import { assertScrubbed, awaitNativeStatus } from '#testing/session-deletion';

for (const checkpoint of [false, true]) {
  test(`attachment-only ${checkpoint ? 'generated checkpoint awaiting publication' : 'pending reply'} is retired by exact historical Source Document`, async () => {
    const f = await documentTransformFixture();

    try {
      const source = await Effect.runPromise(
        Effect.flatMap(Sources, (sources) =>
          sources.createSource({
            name: 'attachment.txt',
            bytes: new TextEncoder().encode('Historical attachment evidence'),
            projectId: null
          })
        ).pipe(Effect.provide(f.domain()))
      );

      const old = await processSource(f);

      const otherSource = await Effect.runPromise(
        Effect.flatMap(Sources, (sources) =>
          sources.createSource({
            name: 'other.txt',
            bytes: new TextEncoder().encode('Independent attachment evidence'),
            projectId: null
          })
        ).pipe(Effect.provide(f.domain()))
      );

      await processSource(f);

      const saved = await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;

          const session = yield* c.createUntitledSession({});

          const other = yield* c.createUntitledSession({});

          yield* c.postMessage({
            sessionId: session.id,
            text: 'Question with attachment',
            sourceIds: [source.id],
            requestReply: false
          });

          yield* c.postMessage({
            sessionId: other.id,
            text: 'Other question',
            sourceIds: [otherSource.id],
            requestReply: false
          });

          const completed = yield* c.requestReply({
            sessionId: session.id,
            intentKey: 'published-attachment-copy'
          });

          yield* withTestPublication(
            f.context,
            c
              .publishReply({
                requestId: completed.requestId,
                text: 'PUBLISHED_ATTACHMENT_COPY [1]',
                citations: [
                  {
                    marker: 1,
                    sourceId: source.id,
                    documentId: old.documentId,
                    blockOrdinal: 0,
                    quote: 'Historical attachment evidence'
                  }
                ]
              })
              .pipe(Effect.asVoid)
          );

          const published = yield* c.message(completed.messageId);

          const input = {
            sessionId: session.id,
            intentKey: 'attachment-only-private',
            instruction: 'ATTACHMENT_PRIVATE_INSTRUCTION',
            preferences: {}
          };

          const pending = yield* c.requestReply(input);

          const snapshot = yield* c.replySnapshot({ requestId: pending.requestId });

          const unrelated = yield* c.requestReply({
            sessionId: other.id,
            intentKey: 'unrelated-attachment'
          });

          const unrelatedSnapshot = yield* c.replySnapshot({ requestId: unrelated.requestId });

          assert.deepEqual(snapshot.context?.inputs, []);

          assert.ok(
            snapshot.messages
              .flatMap((message) => message.attachments)
              .some(
                (attachment) =>
                  attachment.sourceId === source.id && attachment.documentId === old.documentId
              )
          );

          return { input, pending, snapshot, completed, published, unrelated, unrelatedSnapshot };
        }).pipe(Effect.provide(f.domain()))
      );

      const event = f.context.db.orm
        .select()
        .from(s.workflowEvents)
        .where(eq(s.workflowEvents.type, 'ConversationGenerationRequested'))
        .all()
        .map((row) => decodeEvent(row.payload))
        .find(
          (e) =>
            e.type === 'ConversationGenerationRequested' && e.requestId === saved.pending.requestId
        );

      assert.ok(event?.type === 'ConversationGenerationRequested');

      const unrelatedEvent = f.context.db.orm
        .select()
        .from(s.workflowEvents)
        .where(eq(s.workflowEvents.type, 'ConversationGenerationRequested'))
        .all()
        .map((row) => decodeEvent(row.payload))
        .find(
          (e) =>
            e.type === 'ConversationGenerationRequested' &&
            e.requestId === saved.unrelated.requestId
        );

      assert.ok(unrelatedEvent?.type === 'ConversationGenerationRequested');

      const gate = DurableDeferred.make('history-reply-publication-gap');

      const publication = {
        requestId: saved.pending.requestId,
        text: 'ATTACHMENT_PRIVATE_CHECKPOINT [1]',
        citations: [
          {
            marker: 1,
            sourceId: source.id,
            documentId: old.documentId,
            blockOrdinal: 0,
            quote: 'Historical attachment evidence'
          }
        ]
      };

      if (checkpoint) {
        // Fail the actual publication after the real provider result has checkpointed.
        f.context.db.orm.run(
          sql`CREATE TRIGGER reject_history_reply_publication BEFORE UPDATE OF status ON message_versions WHEN NEW.status='complete' BEGIN SELECT RAISE(ABORT,'injected publication gap'); END`
        );

        f.replies.push(
          { kind: 'sources', query: 'Historical attachment' },
          { kind: 'output', output: publication.text }
        );

        await assert.rejects(
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const engine = yield* WorkflowEngine.WorkflowEngine;

                yield* engine.register(conversationReplyWorkflow, conversationReplyHandler);

                yield* engine.execute(conversationReplyWorkflow, {
                  executionId: 'history-attachment-reply',
                  payload: { event }
                });
              }).pipe(Effect.provide(f.services()))
            )
          )
        );

        await Effect.runPromise(awaitNativeStatus(f, 'history-attachment-reply', 'completed'));

        const generated = workflowStore(f.context).activity(
          'history-attachment-reply',
          'generate-reply',
          1
        );

        assert.ok(generated?.includes('ATTACHMENT_PRIVATE_CHECKPOINT'));

        f.context.db.orm.run(sql`DROP TRIGGER reject_history_reply_publication`);
      }

      await Effect.runPromise(
        Effect.flatMap(Sources, (sources) =>
          sources.replaceSource({
            id: source.id,
            expectedRevision: 1,
            name: 'replacement.txt',
            bytes: new TextEncoder().encode('Current attachment evidence')
          })
        ).pipe(Effect.provide(f.domain()))
      );

      const current = await processSource(f);

      function pausedReply({
        event: captured
      }: typeof conversationReplyWorkflow.payloadSchema.Type) {
        return Effect.gen(function* () {
          yield* DurableDeferred.await(gate);

          return captured.versionId;
        });
      }

      if (!checkpoint) {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const engine = yield* WorkflowEngine.WorkflowEngine;

              const m = yield* Materials;

              yield* engine.register(conversationReplyWorkflow, pausedReply);

              yield* engine.register(materialHistoryWorkflow, materialHistoryHandler);

              yield* engine.execute(conversationReplyWorkflow, {
                executionId: 'history-attachment-reply',
                payload: { event },
                discard: true
              });

              yield* awaitNativeStatus(f, 'history-attachment-reply', 'suspended');
              yield* engine.execute(conversationReplyWorkflow, {
                executionId: 'history-unrelated-attachment',
                payload: { event: unrelatedEvent },
                discard: true
              });
              yield* awaitNativeStatus(f, 'history-unrelated-attachment', 'suspended');

              const scope = { materialId: old.projected.extracted.id, policy: { keepLatest: 1 } };

              const preview = yield* m.previewHistoryPrune(scope);

              assert.ok(preview.candidateIds.includes(old.projected.extracted.version.id));

              assert.ok(preview.privateRequestIds.includes(saved.pending.requestId));

              assert.ok(!preview.privateRequestIds.includes(saved.unrelated.requestId));

              yield* m.requestHistoryPrune({
                ...scope,
                operationId: 'history-attachment',
                candidateIds: preview.candidateIds,
                token: preview.token
              });

              yield* engine.execute(materialHistoryWorkflow, {
                executionId: 'history-test/history-attachment/1',
                payload: { event: historyEvent(f, 'history-attachment') }
              });

              yield* awaitNativeStatus(f, 'history-attachment-reply', 'cancelled');
              assert.equal(
                workflowStore(f.context).execution('history-unrelated-attachment')?.status,
                'suspended'
              );

              yield* engine.deferredDone(gate, {
                workflowName: conversationReplyWorkflow._tag,
                executionId: 'history-attachment-reply',
                deferredName: gate.name,
                exit: Exit.void
              });

              assert.equal(
                workflowStore(f.context).deferred('history-attachment-reply', gate.name),
                undefined
              );
            }).pipe(Effect.provide(f.services()))
          )
        );
      } else {
        const preview = await Effect.runPromise(
          Effect.flatMap(Materials, (m) =>
            m.previewHistoryPrune({
              materialId: old.projected.extracted.id,
              policy: { keepLatest: 1 }
            })
          ).pipe(Effect.provide(f.domain()))
        );

        assert.ok(preview.privateRequestIds.includes(saved.pending.requestId));

        assert.ok(!preview.privateRequestIds.includes(saved.unrelated.requestId));

        await acceptHistory(f, old.projected.extracted.id, 'history-attachment');

        await cleanupHistory(f, 'history-attachment');
      }

      f.reopen();

      assertScrubbed(f, 'ATTACHMENT_PRIVATE_INSTRUCTION');

      assertScrubbed(f, 'ATTACHMENT_PRIVATE_CHECKPOINT');

      const native = workflowStore(f.context).execution('history-attachment-reply');

      assert.ok(native);

      assert.equal(native.payload, '{}');

      assert.equal(native.result, null);

      assert.equal(native.owner_token, null);

      assert.deepEqual(
        f.context.db.orm
          .select()
          .from(s.workflow_activities)
          .where(eq(s.workflow_activities.execution_id, native.execution_id))
          .all(),
        []
      );

      assert.deepEqual(
        f.context.db.orm
          .select()
          .from(s.conversation_reply_requests)
          .where(eq(s.conversation_reply_requests.request_id, saved.pending.requestId))
          .all(),
        []
      );

      assert.deepEqual(
        f.context.db.orm
          .select()
          .from(s.session_run_contexts)
          .where(eq(s.session_run_contexts.request_id, saved.pending.requestId))
          .all(),
        []
      );

      assert.ok(
        f.context.db.orm
          .select()
          .from(s.conversation_history_intents)
          .where(eq(s.conversation_history_intents.request_id, saved.pending.requestId))
          .get()
      );

      assert.ok(
        f.context.db.orm
          .select()
          .from(s.workflow_retired_executions)
          .where(eq(s.workflow_retired_executions.execution_id, native.execution_id))
          .get()
      );

      assert.throws(() =>
        f.context.transaction(() =>
          emitEvent(f.context, { ...event, eventId: 'late-attachment-event' }, 1)
        )
      );

      assert.throws(() =>
        f.context.db.orm
          .insert(s.material_history_requests)
          .values({
            operation_id: 'history-attachment',
            request_id: saved.unrelated.requestId,
            kind: 'context'
          })
          .run()
      );

      assert.throws(
        () =>
          f.context.db.orm
            .insert(s.conversation_reply_requests)
            .values({
              request_id: 'fresh-pruned-attachment',
              session_id: saved.unrelated.sessionId,
              version_id: saved.unrelated.versionId,
              snapshot: JSON.stringify(
                { ...saved.snapshot, requestId: 'fresh-pruned-attachment' },
                (_, value) => (typeof value === 'bigint' ? String(value) : value)
              )
            })
            .run(),
        (error: unknown) => error instanceof Error && 'errcode' in error && error.errcode === 1811
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const c = yield* Conversations;

          const published = yield* c.message(saved.completed.messageId);

          assert.deepEqual(published.versions, saved.published.versions);

          assert.equal(published.citations[0]?.quote, 'Historical attachment evidence');

          assert.deepEqual(
            yield* c.replySnapshot({ requestId: saved.unrelated.requestId }),
            saved.unrelatedSnapshot
          );

          assert.equal((yield* Effect.flip(c.requestReply(saved.input))).kind, 'not_found');

          const fresh = yield* c.requestReply({
            ...saved.input,
            intentKey: 'fresh-attachment-root',
            instruction: 'New work on current attachment'
          });

          const freshSnapshot = yield* c.replySnapshot({ requestId: fresh.requestId });

          assert.ok(
            freshSnapshot.messages
              .flatMap((message) => message.attachments)
              .some(
                (attachment) =>
                  attachment.sourceId === source.id && attachment.documentId === current.documentId
              )
          );

          assert.equal(
            (yield* (yield* Materials).material({ id: current.projected.extracted.id })).version.id,
            current.projected.extracted.version.id
          );
        }).pipe(Effect.provide(f.domain()))
      );

      await assert.rejects(
        Effect.runPromise(
          withTestPublication(
            f.context,
            Effect.flatMap(Conversations, (c) => c.publishReply(publication)).pipe(
              Effect.asVoid,
              Effect.provide(f.domain())
            )
          ).pipe(Effect.provide(f.domain()))
        )
      );

      // Retired checkpoints and deferred results cannot be reinserted even by a late native writer.
      assert.throws(() =>
        f.context.db.orm
          .insert(s.workflow_activities)
          .values({
            execution_id: native.execution_id,
            name: 'generate-reply',
            attempt: 99,
            result: JSON.stringify(publication, (_, value) =>
              typeof value === 'bigint' ? String(value) : value
            )
          })
          .run()
      );

      assert.throws(() =>
        f.context.db.orm
          .insert(s.workflow_deferreds)
          .values({ execution_id: native.execution_id, name: gate.name, result: '{}' })
          .run()
      );
    } finally {
      await f.close();
    }
  });
}
