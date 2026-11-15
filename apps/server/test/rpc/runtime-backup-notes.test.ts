/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises reply and rewrite retirement through public requests and fresh restore.  │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves completed history and inspection while rejecting consumed actionable intent. │
 * │ - Proves restored notes accept fresh replies without resuming captured native work.      │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Real temporary SQLite and HTTP RPC; no model request or direct feature-state mutation.   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyRpc } from '@study/contracts';
import * as s from '@study/db';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { Notes } from '#server/features/notes/index';
import { serve } from '#server/runtime/index';
import { acceptance, backupFixture } from '#testing/managed-backups';
import { admitTestExecution } from '#testing/workflow-admission';

for (const operation of ['answer', 'rewrite', 'ask'] as const)
  testStable(
    `restored pending ${operation} preserves its pending shell, history and admitted intent`,
    async () => {
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

              const note = yield* client['notes.createNote']({
                project: project.id,
                title: 'Retained'
              });

              const message = yield* client['notes.postMessage']({
                noteId: note.id,
                text: 'Exact completed message'
              });

              const before = yield* client['notes.message']({ id: message.id });

              const request =
                operation === 'ask'
                  ? yield* client['notes.ask']({
                      noteId: note.id,
                      intentKey: 'consumed-ask',
                      expectedSelectionRevision: 0n,
                      text: 'Atomic backup note'
                    })
                  : operation === 'answer'
                    ? yield* client['notes.requestReply']({
                        noteId: note.id,
                        intentKey: 'consumed-answer'
                      })
                    : yield* client['notes.rewriteMessage']({
                        messageId: message.id,
                        origin: 'instruction',
                        instruction: 'Private unfinished instruction'
                      });

              return { note, message, before, request };
            })
          )
        );

        const context = await source.app.nativeRuntime.runPromise(
          Effect.flatMap(Notes, (c) => c.noteContext({ requestId: captured.request.requestId }))
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

        const imported = await target.app.nativeRuntime.runPromise(
          targetApi.importBackup({ bytes })
        );

        const preview = await target.app.nativeRuntime.runPromise(
          targetApi.previewRestore({ id: imported.id })
        );

        assert.ok(preview.blockedByCurrentBarriers === false);
        await target.app.nativeRuntime.runPromise(targetApi.acceptRestore(acceptance(preview)));
        await target.reopen();

        const app = target.app;

        const notes = await app.nativeRuntime.runPromise(Notes);

        assert.ok(
          app.store.db.orm
            .select()
            .from(s.message_versions)
            .all()
            .some((version) => version.id === captured.request.versionId)
        );
        expect(
          await app.nativeRuntime.runPromise(
            notes.noteContext({ requestId: captured.request.requestId })
          )
        ).toStrictEqual(context);
        assert.ok(
          await app.nativeRuntime.runPromise(
            notes.replySnapshot({ requestId: captured.request.requestId })
          )
        );
        expect(target.requests).toStrictEqual([]);

        await expect(
          app.nativeRuntime.runPromise(
            notes.requestReply({ noteId: captured.note.id, intentKey: 'fresh-intent' })
          )
        ).rejects.toMatchObject({ kind: 'invalid_input' });

        const next = await app.nativeRuntime.runPromise((await target.api()).createBackup());

        assert.strictEqual(next.scope.notes, backup.scope.notes);
        assert.strictEqual(next.scope.tombstones, 0);
      } finally {
        await server.close();
        await target?.close();
        await source.close();
      }
    }
  );

testStable('an unused retained capture preserves its authority after restore', async () => {
  const source = await backupFixture();

  let target: Awaited<ReturnType<typeof backupFixture>> | undefined;

  try {
    const c = await source.app.nativeRuntime.runPromise(Notes);

    const note = await source.app.nativeRuntime.runPromise(c.createUntitledNote({}));

    await source.app.nativeRuntime.runPromise(
      c.postMessage({ noteId: note.id, text: 'Retained capture' })
    );

    const capture = await source.app.nativeRuntime.runPromise(
      c.captureNoteContext({
        noteId: note.id,
        intentKey: 'unused',
        instruction: '',
        preferences: {}
      })
    );

    const { exportSnapshot, restoreSnapshot } = await import('#testing/managed-backups');

    const bytes = await exportSnapshot(source.app.store.db);

    await source.suspend();
    target = await restoreSnapshot(bytes);

    const restored = await target.app.nativeRuntime.runPromise(Notes);

    expect(
      await target.app.nativeRuntime.runPromise(
        restored.inspectNoteContext({ requestId: capture.requestId })
      )
    ).toStrictEqual(capture);

    const request = await target.app.nativeRuntime.runPromise(
      restored.requestPageTransform({
        contextRequestId: capture.requestId,
        title: 'Resume',
        operations: ['clarity']
      })
    );

    assert.strictEqual(request.cancelled, false);
    assert.strictEqual(
      target.app.store.db.orm.select().from(s.material_generation_requests).all().length,
      0
    );
  } finally {
    await target?.close();
    await source.close();
  }
});

testStable('a completed native answer and pending rewrite both survive restore', async () => {
  const { pageTransformFixture } = await import('#testing/page-transform');

  const { exportSnapshot, restoreSnapshot } = await import('#testing/managed-backups');

  const { noteReplyWorkflow, noteReplyHandler } =
    await import('#server/features/notes/workflows/index');

  const { decodeEvent } = await import('#server/platform/workflows/events');

  const { WorkflowEngine } = await import('effect/workflow');

  const source = await pageTransformFixture();

  let target: Awaited<ReturnType<typeof restoreSnapshot>> | undefined;

  try {
    const requested = await Effect.runPromise(
      Effect.gen(function* () {
        const c = yield* Notes;

        const note = yield* c.createUntitledNote({});

        const request = yield* c.ask({
          noteId: note.id,
          text: 'A completed native answer',
          expectedSelectionRevision: 0n,
          intentKey: 'completed-answer'
        });

        return { note, request };
      }).pipe(Effect.provide(source.domain()))
    );

    const event = source.context.db.orm
      .select()
      .from(s.workflowEvents)
      .all()
      .map((row) => decodeEvent(row.payload))
      .find(
        (event) =>
          event.type === 'NoteGenerationRequested' &&
          event.requestId === requested.request.requestId
      );

    assert.ok(event?.type === 'NoteGenerationRequested');

    source.replies.push({ kind: 'output', output: 'Exact native answer' });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const engine = yield* WorkflowEngine.WorkflowEngine;

          admitTestExecution(source.context, noteReplyWorkflow, 'completed-answer', { event });
          yield* engine.register(noteReplyWorkflow, noteReplyHandler);
          yield* engine.execute(noteReplyWorkflow, {
            executionId: 'completed-answer',
            payload: { event }
          });
        }).pipe(Effect.provide(source.services()))
      )
    );

    const before = await Effect.runPromise(
      Effect.flatMap(Notes, (c) => c.message(requested.request.messageId)).pipe(
        Effect.provide(source.domain())
      )
    );

    const snapshot = await Effect.runPromise(
      Effect.flatMap(Notes, (c) =>
        c.inspectReplySnapshot({ requestId: requested.request.requestId })
      ).pipe(Effect.provide(source.domain()))
    );

    const rewrite = await Effect.runPromise(
      Effect.flatMap(Notes, (c) =>
        c.rewriteMessage({ messageId: requested.request.messageId, origin: 'improve' })
      ).pipe(Effect.provide(source.domain()))
    );

    const bytes = await exportSnapshot(source.context.db);

    await source.close();
    target = await restoreSnapshot(bytes);

    const app = target.app;

    const c = await app.nativeRuntime.runPromise(Notes);

    expect(
      await app.nativeRuntime.runPromise(c.message(requested.request.messageId))
    ).toMatchObject({
      activeVersionId: rewrite.versionId,
      versions: expect.arrayContaining(before.versions)
    });
    expect(
      await app.nativeRuntime.runPromise(
        c.inspectReplySnapshot({ requestId: requested.request.requestId })
      )
    ).toStrictEqual(snapshot);
    assert.ok(
      app.store.db.orm
        .select()
        .from(s.message_versions)
        .all()
        .some((version) => version.id === rewrite.versionId)
    );
    expect(
      await app.nativeRuntime.runPromise(c.message(requested.request.messageId))
    ).toMatchObject({
      activeVersionId: rewrite.versionId,
      versions: expect.arrayContaining(before.versions)
    });
  } finally {
    await target?.close();
    await source.close();
  }
});
