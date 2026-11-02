/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises reply and rewrite retirement through public requests and fresh restore.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves completed history and inspection while rejecting consumed actionable intent. │
 * │ - Proves restored sessions accept fresh replies without resuming captured native work.   │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Real temporary SQLite and HTTP RPC; no model request or direct feature-state mutation.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { StudyRpc } from '@study/contracts/rpc';
import * as s from '@study/db/schema';
import { Effect } from 'effect';

import { makeStudyClient } from '#server/client/index';
import { Conversations } from '#server/features/conversations/index';
import { serve } from '#server/runtime/index';
import { acceptance, backupFixture } from '#testing/managed-backups';

for (const operation of ['answer', 'rewrite'] as const)
  test(`restored pending ${operation} retires its shell, preserves completed history and permits fresh intent`, async () => {
    const source = await backupFixture();

    let target: Awaited<ReturnType<typeof backupFixture>> | undefined;

    const server = await serve(source.app);

    try {
      const captured = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* makeStudyClient(StudyRpc, { baseUrl: server.url });

            const project = yield* client['projects.createProject']({
              name: 'Backup conversation'
            });

            const session = yield* client['conversations.createSession']({
              project: project.id,
              title: 'Retained'
            });

            const message = yield* client['conversations.postMessage']({
              sessionId: session.id,
              text: 'Exact completed message'
            });

            const before = yield* client['conversations.message']({ id: message.id });

            const request =
              operation === 'answer'
                ? yield* client['conversations.requestReply']({
                    sessionId: session.id,
                    intentKey: 'consumed-answer'
                  })
                : yield* client['conversations.rewriteMessage']({
                    messageId: message.id,
                    origin: 'instruction',
                    instruction: 'Private unfinished instruction'
                  });

            return { session, message, before, request };
          })
        )
      );

      const context = await source.app.nativeRuntime.runPromise(
        Effect.flatMap(Conversations, (c) =>
          c.sessionContext({ requestId: captured.request.requestId })
        )
      );

      const api = await source.api();

      const backup = await source.app.nativeRuntime.runPromise(api.createBackup());

      const bytes = await source.app.nativeRuntime.runPromise(api.readBackup({ id: backup.id }));

      // Snapshot retirement must not alter the still-live pending version.
      assert.ok(
        source.app.store.db.orm
          .select()
          .from(s.message_versions)
          .all()
          .some((v) => v.id === captured.request.versionId)
      );
      await server.close();
      await source.suspend();
      target = await backupFixture();

      const targetApi = await target.api();

      const imported = await target.app.nativeRuntime.runPromise(targetApi.importBackup({ bytes }));

      const preview = await target.app.nativeRuntime.runPromise(
        targetApi.previewRestore({ id: imported.id })
      );

      assert.equal(preview.blockedByCurrentBarriers, false);
      await target.app.nativeRuntime.runPromise(targetApi.acceptRestore(acceptance(preview)));
      await target.reopen();

      const app = target.app;

      const conversations = await app.nativeRuntime.runPromise(Conversations);

      assert.deepEqual(
        await app.nativeRuntime.runPromise(conversations.message(captured.message.id)),
        captured.before
      );
      assert.equal(
        app.store.db.orm
          .select()
          .from(s.message_versions)
          .all()
          .some((v) => v.id === captured.request.versionId),
        false
      );

      if (operation === 'answer')
        assert.equal(
          app.store.db.orm
            .select()
            .from(s.messages)
            .all()
            .some((m) => m.id === captured.request.messageId),
          false
        );

      // The capture is inspectable, but the old execution and consumed intent have no authority.
      assert.deepEqual(
        await app.nativeRuntime.runPromise(
          conversations.inspectSessionContext({ requestId: captured.request.requestId })
        ),
        context
      );

      for (const action of [
        conversations.sessionContext({ requestId: captured.request.requestId }),
        conversations.replySnapshot({ requestId: captured.request.requestId }),
        conversations.requestReply({
          sessionId: captured.session.id,
          intentKey: context.intentKey,
          instruction: context.instruction,
          preferences: context.preferences
        })
      ])
        assert.equal((await app.nativeRuntime.runPromise(Effect.flip(action))).kind, 'not_found');

      await app.workers.start();
      await app.workers.stop();
      assert.equal(app.store.db.orm.select().from(s.workflow_executions).all().length, 0);
      assert.deepEqual(target.requests, []);

      const fresh = await app.nativeRuntime.runPromise(
        conversations.requestReply({ sessionId: captured.session.id, intentKey: 'fresh-intent' })
      );

      assert.notEqual(fresh.requestId, captured.request.requestId);
      assert.equal(
        (
          await app.nativeRuntime.runPromise(
            conversations.replySnapshot({ requestId: fresh.requestId })
          )
        ).messages[0]?.text,
        'Exact completed message'
      );
      // A second backup retires only the fresh pending work; importing restored data is idempotent.

      const next = await app.nativeRuntime.runPromise((await target.api()).createBackup());

      assert.equal(next.scope.sessions, backup.scope.sessions);
      assert.equal(next.scope.tombstones, 0);
    } finally {
      await server.close();
      await target?.close();
      await source.close();
    }
  });

test('an unused retained capture is inspectable after restore but cannot authorize a new transform', async () => {
  const source = await backupFixture();

  let target: Awaited<ReturnType<typeof backupFixture>> | undefined;

  try {
    const c = await source.app.nativeRuntime.runPromise(Conversations);

    const session = await source.app.nativeRuntime.runPromise(c.createUntitledSession({}));

    await source.app.nativeRuntime.runPromise(
      c.postMessage({ sessionId: session.id, text: 'Retained capture' })
    );

    const capture = await source.app.nativeRuntime.runPromise(
      c.captureSessionContext({
        sessionId: session.id,
        intentKey: 'unused',
        instruction: '',
        preferences: {}
      })
    );

    const { exportSnapshot, restoreSnapshot } = await import('#testing/managed-backups');

    const bytes = await exportSnapshot(source.app.store.db);

    await source.suspend();
    target = await restoreSnapshot(bytes);

    const restored = await target.app.nativeRuntime.runPromise(Conversations);

    assert.deepEqual(
      await target.app.nativeRuntime.runPromise(
        restored.inspectSessionContext({ requestId: capture.requestId })
      ),
      capture
    );

    const error = await target.app.nativeRuntime.runPromise(
      Effect.flip(
        restored.requestDocumentTransform({
          contextRequestId: capture.requestId,
          title: 'Cannot resume',
          operations: ['clarity']
        })
      )
    );

    assert.equal(error.kind, 'not_found');
    assert.equal(
      target.app.store.db.orm.select().from(s.material_generation_requests).all().length,
      0
    );
  } finally {
    await target?.close();
    await source.close();
  }
});

test('a completed native answer survives a pending rewrite and late reply publication stays fenced', async () => {
  const { documentTransformFixture } = await import('#testing/document-transform');

  const { exportSnapshot, restoreSnapshot } = await import('#testing/managed-backups');

  const { conversationReplyWorkflow, conversationReplyHandler } =
    await import('#server/features/conversations/workflows/index');

  const { decodeEvent } = await import('#server/platform/workflows/events');

  const { WorkflowEngine } = await import('effect/workflow');

  const { withTestPublication } = await import('#testing/publication');

  const source = await documentTransformFixture();

  let target: Awaited<ReturnType<typeof restoreSnapshot>> | undefined;

  try {
    const requested = await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Conversations;

        const session = yield* c.createUntitledSession({});

        yield* c.postMessage({ sessionId: session.id, text: 'A completed native answer' });

        const request = yield* c.requestReply({
          sessionId: session.id,
          intentKey: 'completed-answer'
        });

        return { session, request };
      }).pipe(Effect.provide(source.domain()))
    );

    const event = source.context.db.orm
      .select()
      .from(s.workflowEvents)
      .all()
      .map((row) => decodeEvent(row.payload))
      .find(
        (event) =>
          event.type === 'ConversationGenerationRequested' &&
          event.requestId === requested.request.requestId
      );
    assert.ok(event?.type === 'ConversationGenerationRequested');

    source.replies.push({ kind: 'output', output: 'Exact native answer' });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          yield* engine.register(conversationReplyWorkflow, conversationReplyHandler);
          yield* engine.execute(conversationReplyWorkflow, {
            executionId: 'completed-answer',
            payload: { event }
          });
        }).pipe(Effect.provide(source.services()))
      )
    );

    const before = await Effect.runPromise(
      Effect.flatMap(Conversations, (c) => c.message(requested.request.messageId)).pipe(
        Effect.provide(source.domain())
      )
    );

    const snapshot = await Effect.runPromise(
      Effect.flatMap(Conversations, (c) =>
        c.inspectReplySnapshot({ requestId: requested.request.requestId })
      ).pipe(Effect.provide(source.domain()))
    );

    const rewrite = await Effect.runPromise(
      Effect.flatMap(Conversations, (c) =>
        c.rewriteMessage({ messageId: requested.request.messageId, origin: 'improve' })
      ).pipe(Effect.provide(source.domain()))
    );

    const bytes = await exportSnapshot(source.context.db);

    await source.close();
    target = await restoreSnapshot(bytes);

    const app = target.app;

    const c = await app.nativeRuntime.runPromise(Conversations);

    assert.deepEqual(
      await app.nativeRuntime.runPromise(c.message(requested.request.messageId)),
      before
    );
    assert.deepEqual(
      await app.nativeRuntime.runPromise(
        c.inspectReplySnapshot({ requestId: requested.request.requestId })
      ),
      snapshot
    );
    assert.equal(
      (
        await app.nativeRuntime.runPromise(
          Effect.flip(c.replySnapshot({ requestId: requested.request.requestId }))
        )
      ).kind,
      'not_found'
    );
    assert.equal(
      (
        await app.nativeRuntime.runPromise(
          Effect.flip(
            withTestPublication(
              app.store,
              c
                .publishReply({
                  requestId: rewrite.requestId,
                  text: 'Late private answer',
                  citations: []
                })
                .pipe(Effect.asVoid)
            )
          )
        )
      ).kind,
      'not_found'
    );
    assert.deepEqual(
      await app.nativeRuntime.runPromise(c.message(requested.request.messageId)),
      before
    );
  } finally {
    await target?.close();
    await source.close();
  }
});
