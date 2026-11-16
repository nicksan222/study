import { materialSearchInputSchema } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Requests reply and title generation over native RPC while signed out and verifies  │
 * │ both enter durable configuration waits without scheduled clocks. Note messages           │
 * │ remain pending and visible.                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Covers durable sign-in waits, atomic Ask reopen and exact reply provenance.            │
 * │ - Exercises bounded Material-only search through the native service composition.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses #server/client/index, #server/runtime/index with real SQLite and application        │
 * │ resources; fixture cleanup closes owned resources.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { sql } from '@study/db';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

test.stable(
  'a reply requested over RPC reaches the durable sign-in wait',
  { timeout: 10000 },
  async ({ rpc }) => {
    await rpc.app.workers.start();
    await rpc.runPromise(
      Effect.gen(function* () {
        const client = rpc.client;
        const project = yield* client['projects.createProject']({ name: 'Note' });
        const note = yield* client['notes.createNote']({
          project: project.id,
          title: 'Chat'
        });

        yield* client['notes.postMessage']({
          noteId: note.id,
          text: 'Explain ATP'
        });
        const request = yield* client['notes.requestReply']({ noteId: note.id });

        yield* test.pollUntil(
          Effect.sync(() => {
            const rows = rpc.app.store.db.orm.all(
              sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id=w.execution_id WHERE e.workflow_tag='conversation-reply/v1'`
            );

            return rows.length === 1;
          }),
          (value) => value,
          {
            attempts: 100,
            interval: '50 millis',
            message: 'reply must wait durably for account setup'
          }
        );
        const untitled = yield* client['notes.createUntitledNote']({
          project: project.id
        });

        yield* client['notes.postMessage']({
          noteId: untitled.id,
          text: 'Study photosynthesis'
        });
        yield* client['notes.requestTitle']({ noteId: untitled.id });
        yield* test.pollUntil(
          Effect.sync(
            () =>
              rpc.app.store.db.orm.all(
                sql`SELECT w.execution_id FROM workflow_configuration_waits w JOIN workflow_executions e ON e.execution_id=w.execution_id WHERE e.workflow_tag='conversation-title/v1'`
              ).length === 1
          ),
          (value) => value,
          {
            attempts: 100,
            interval: '50 millis',
            message: 'title request must enter durable configuration wait'
          }
        );

        const message = yield* client['notes.message']({ id: request.messageId });

        test.assert.ok(
          message.versions.find((version) => version.id === request.versionId)?.status === 'pending'
        );
        test.assert.strictEqual(
          (yield* client['notes.thread']({ noteId: note.id, limit: 10 })).items.length,
          2
        );
      })
    );
  }
);

test.stable(
  'atomic Ask returns its note and exact request over native HTTP RPC after process reopen',
  async ({ rpc }) => {
    const saved = await rpc.runPromise(
      Effect.gen(function* () {
        const client = rpc.client;
        const note = yield* client['notes.createNote']({ title: 'Atomic Ask' });
        const input = {
          noteId: note.id,
          intentKey: 'native-ask',
          expectedSelectionRevision: 0n,
          text: 'Exact note'
        };
        const result = yield* client['notes.ask'](input);

        test.assert.strictEqual(
          (yield* client['notes.message']({ id: result.userMessageId })).activeVersionId,
          result.userVersionId
        );
        test.expect(yield* client['notes.ask'](input)).toStrictEqual(result);

        return { input, result };
      })
    );

    await rpc.reopen();
    await rpc.runPromise(
      Effect.gen(function* () {
        const client = rpc.client;

        test.expect(yield* client['notes.ask'](saved.input)).toStrictEqual(saved.result);
        test
          .expect(
            yield* client['notes.replyVersion']({
              noteId: saved.input.noteId,
              messageId: saved.result.messageId,
              versionId: saved.result.versionId
            })
          )
          .toStrictEqual({ state: 'available', requestId: saved.result.requestId });
        test.assert.strictEqual(
          (yield* client['notes.thread']({
            noteId: saved.input.noteId,
            limit: 10
          })).items.length,
          2
        );
      })
    );
  }
);

test.stable(
  'native Material search binds bounded canonical targets without mixing catalog kinds',
  async ({ rpc }) => {
    await rpc.runPromise(
      Effect.gen(function* () {
        const client = rpc.client;
        const project = yield* client['projects.createProject']({ name: 'NativeSearchToken' });
        const material = yield* client['materials.create']({
          title: 'NativeSearchToken',
          content: { kind: 'flashcards', cards: [{ front: 'Question', back: 'Answer' }] },
          publish: true
        });
        const found = yield* client['system.materialSearch'](
          Schema.decodeUnknownSync(materialSearchInputSchema)({
            query: '  NativeSearchToken  ',
            limit: 1
          })
        );

        test.assert.strictEqual(found.hits.length, 1);
        test.assert.ok(found.hits[0]?.kind === 'material');
        test.expect(found.hits[0]?.target).toStrictEqual({
          type: 'material',
          materialId: material.id,
          versionId: material.version.id,
          materialKind: 'flashcards'
        });
        test
          .expect(
            yield* client['system.materialSearch']({
              query: 'NativeSearchToken',
              limit: 1,
              project: project.id
            })
          )
          .toStrictEqual({ hits: [] });
      })
    );
  }
);

test.stable('plain note edits survive closing and reopening native HTTP RPC', async ({ rpc }) => {
  const text =
    'River garden field notebook\n\nFirst observation corrected.\n\nMiddle observation corrected.\n\nLast observation corrected.';

  const saved = await rpc.runPromise(
    Effect.gen(function* () {
      const client = rpc.client;
      const note = yield* client['notes.createNote']({ title: 'River garden field notebook' });
      let message = yield* client['notes.postMessage']({
        noteId: note.id,
        text: 'Original observation',
        requestReply: false
      });

      for (const content of [
        'First observation corrected.',
        'First observation corrected.\n\nMiddle observation corrected.',
        text
      ]) {
        message = yield* client['notes.editMessage']({
          messageId: message.id,
          expectedActiveVersionId: message.activeVersionId ?? undefined,
          text: content
        });
      }

      return { note, message };
    })
  );

  await rpc.reopen();
  await rpc.runPromise(
    Effect.gen(function* () {
      const client = rpc.client;
      const thread = yield* client['notes.thread']({ noteId: saved.note.id, limit: 100 });

      test.assert.strictEqual(thread.items.length, 1);
      const message = thread.items[0]!;

      test.assert.strictEqual(message.id, saved.message.id);
      test.assert.strictEqual(message.role, 'user');
      test.assert.strictEqual(message.activeVersionId, saved.message.activeVersionId);
      test.assert.strictEqual(
        message.versions.find((version) => version.id === message.activeVersionId)?.text,
        text
      );
      const notes = yield* client['notes.notes']({ limit: 100 });

      test.assert.strictEqual(notes.items.length, 1);
      test.assert.strictEqual(notes.items[0]?.id, saved.note.id);
    })
  );
});
