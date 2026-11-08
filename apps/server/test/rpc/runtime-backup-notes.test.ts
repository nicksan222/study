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

import { StudyRpc } from '@study/contracts/rpc';
import * as s from '@study/db/schema';
import { testStable } from '@study/testing/vitest';
import { Effect } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { makeStudyClient } from '#server/client/index';
import { Notes } from '#server/features/notes/index';
import { serve } from '#server/runtime/index';
import { acceptance, backupFixture } from '#testing/managed-backups';

for (const operation of ['answer', 'rewrite', 'ask'] as const)
  testStable(
    `restored pending ${operation} retires its shell, preserves completed history and permits fresh intent`,
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

        expect(
          await app.nativeRuntime.runPromise(notes.message(captured.message.id))
        ).toStrictEqual(captured.before);
        assert.ok(
          app.store.db.orm
            .select()
            .from(s.message_versions)
            .all()
            .some((v) => v.id === captured.request.versionId) === false
        );

        if (operation === 'answer' || operation === 'ask')
          assert.ok(
            app.store.db.orm
              .select()
              .from(s.messages)
              .all()
              .some((m) => m.id === captured.request.messageId) === false
          );

        // The capture is inspectable, but the old execution and consumed intent have no authority.
        expect(
          await app.nativeRuntime.runPromise(
            notes.inspectNoteContext({ requestId: captured.request.requestId })
          )
        ).toStrictEqual(context);

        for (const action of [
          notes.noteContext({ requestId: captured.request.requestId }).pipe(Effect.asVoid),
          notes.replySnapshot({ requestId: captured.request.requestId }).pipe(Effect.asVoid),
          notes
            .requestReply({
              noteId: captured.note.id,
              intentKey: context.intentKey,
              instruction: context.instruction,
              preferences: context.preferences
            })
            .pipe(Effect.asVoid)
        ])
          assert.ok((await app.nativeRuntime.runPromise(Effect.flip(action))).kind === 'not_found');

        if (operation === 'ask') {
          assert.ok(
            (
              await app.nativeRuntime.runPromise(
                Effect.flip(
                  notes.ask({
                    noteId: captured.note.id,
                    intentKey: 'consumed-ask',
                    expectedSelectionRevision: 0n,
                    text: 'Atomic backup note'
                  })
                )
              )
            ).kind === 'not_found'
          );
        }

        await app.workers.start();
        await app.workers.stop();
        assert.strictEqual(app.store.db.orm.select().from(s.workflow_executions).all().length, 0);
        expect(target.requests).toStrictEqual([]);

        const fresh = await app.nativeRuntime.runPromise(
          notes.requestReply({ noteId: captured.note.id, intentKey: 'fresh-intent' })
        );

        assert.notStrictEqual(fresh.requestId, captured.request.requestId);
        assert.ok(
          (await app.nativeRuntime.runPromise(notes.replySnapshot({ requestId: fresh.requestId })))
            .messages[0]?.text === 'Exact completed message'
        );
        // A second backup retires only the fresh pending work; importing restored data is idempotent.

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

testStable(
  'an unused retained capture is inspectable after restore but cannot authorize a new transform',
  async () => {
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

      const error = await target.app.nativeRuntime.runPromise(
        Effect.flip(
          restored.requestPageTransform({
            contextRequestId: capture.requestId,
            title: 'Cannot resume',
            operations: ['clarity']
          })
        )
      );

      assert.ok(error.kind === 'not_found');
      assert.strictEqual(
        target.app.store.db.orm.select().from(s.material_generation_requests).all().length,
        0
      );
    } finally {
      await target?.close();
      await source.close();
    }
  }
);

testStable(
  'a completed native answer survives a pending rewrite and late reply publication stays fenced',
  async () => {
    const { pageTransformFixture } = await import('#testing/page-transform');

    const { exportSnapshot, restoreSnapshot } = await import('#testing/managed-backups');

    const { noteReplyWorkflow, noteReplyHandler } =
      await import('#server/features/notes/workflows/index');

    const { decodeEvent } = await import('#server/platform/workflows/events');

    const { WorkflowEngine } = await import('effect/workflow');

    const { withTestPublication } = await import('#testing/publication');

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
      ).toStrictEqual(before);
      expect(
        await app.nativeRuntime.runPromise(
          c.replyVersion({
            noteId: requested.note.id,
            messageId: requested.request.messageId,
            versionId: requested.request.versionId
          })
        )
      ).toStrictEqual({ state: 'retired', requestId: requested.request.requestId });
      assert.ok(
        (
          await app.nativeRuntime.runPromise(
            Effect.flip(
              c.ask({
                noteId: requested.note.id,
                text: 'A completed native answer',
                expectedSelectionRevision: 0n,
                intentKey: 'completed-answer'
              })
            )
          )
        ).kind === 'not_found'
      );
      expect(
        await app.nativeRuntime.runPromise(
          c.inspectReplySnapshot({ requestId: requested.request.requestId })
        )
      ).toStrictEqual(snapshot);
      assert.ok(
        (
          await app.nativeRuntime.runPromise(
            Effect.flip(c.replySnapshot({ requestId: requested.request.requestId }))
          )
        ).kind === 'not_found'
      );
      assert.ok(
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
        ).kind === 'not_found'
      );
      expect(
        await app.nativeRuntime.runPromise(c.message(requested.request.messageId))
      ).toStrictEqual(before);
    } finally {
      await target?.close();
      await source.close();
    }
  }
);
