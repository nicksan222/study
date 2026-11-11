/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exercises note draft reuse and first-capture persistence against real SQLite.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Verifies empty drafts are reused across concurrent requests and collections.           │
 * │ - Confirms captured notes and attachments prevent subsequent draft reuse.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Calls real note services and isolated stores without replacing application               │
 * │ dependencies.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { recordings } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Layer } from 'effect';
import { expect } from 'vite-plus/test';
import { assert } from 'vite-plus/test';

import { Projects } from '#server/features/projects/index';
import { Settings } from '#server/features/settings/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { Notes } from './index.ts';

testStable(
  'new notes reuse one empty draft across concurrent requests and collections',
  async () => {
    const location = await createTestDatabase();
    const context = new ServerContext(await location.open());
    const layer = Layer.mergeAll(Projects.layer, Notes.layer, Settings.layer).pipe(
      Layer.provideMerge(Layer.succeed(Database, { store: context }))
    );

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const notes = yield* Notes;
          const project = yield* (yield* Projects).createProject({ name: 'Drafts' });
          const first = yield* notes.createUntitledNote({});
          const repeated = yield* Effect.all(
            Array.from({ length: 8 }, () => notes.createUntitledNote({})),
            { concurrency: 'unbounded' }
          );

          assert.ok(repeated.every((note) => note.id === first.id));
          const scoped = yield* notes.createUntitledNote({ project: project.id });

          assert.strictEqual(scoped.id, first.id);
          expect(scoped.projectIds).toStrictEqual([project.id]);
          assert.strictEqual((yield* notes.notes({ limit: 100 })).items.length, 1);
          const global = yield* notes.createUntitledNote({});

          assert.strictEqual(global.id, first.id);
          expect(global.projectIds).toStrictEqual([]);
          yield* notes.updateNoteSelection({
            noteId: first.id,
            expectedRevision: 0n,
            targets: []
          });
          assert.strictEqual((yield* notes.createUntitledNote({})).id, first.id);
        }).pipe(Effect.provide(layer))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);

testStable('new notes preserve captured work and explicitly named notes', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const layer = Layer.mergeAll(Notes.layer, Settings.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes;
        const named = yield* notes.createNote({ title: 'Planned study' });
        const first = yield* notes.createUntitledNote({});

        assert.notStrictEqual(first.id, named.id);
        yield* notes.postMessage({ noteId: first.id, text: 'My notes' });
        const second = yield* notes.createUntitledNote({});

        assert.notStrictEqual(second.id, first.id);
        yield* notes.renameNote({ id: second.id, title: 'Next topic' });
        const third = yield* notes.createUntitledNote({});

        assert.notStrictEqual(third.id, second.id);
        assert.strictEqual((yield* notes.createUntitledNote({})).id, third.id);
        assert.ok(
          (yield* notes.thread({ noteId: first.id, limit: 100 })).items[0]?.versions.at(-1)
            ?.text === 'My notes'
        );
        assert.ok((yield* notes.note(second.id)).title === 'Next topic');

        context.transaction((tx) => {
          tx.db.orm
            .insert(recordings)
            .values({
              note_id: third.id,
              started_at: 1n,
              updated_at: 1n
            })
            .run();
        });
        const fourth = yield* notes.createUntitledNote({});

        assert.notStrictEqual(fourth.id, third.id);
        yield* notes.captureNoteContext({
          noteId: fourth.id,
          additionalNoteIds: [first.id],
          intentKey: 'draft-context',
          instruction: 'Keep this instruction',
          preferences: {}
        });
        const fifth = yield* notes.createUntitledNote({});

        assert.notStrictEqual(fifth.id, fourth.id);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});

testStable('first send atomically creates a visible note and first message', async () => {
  const location = await createTestDatabase();
  const context = new ServerContext(await location.open());
  const layer = Layer.mergeAll(Notes.layer, Settings.layer).pipe(
    Layer.provideMerge(Layer.succeed(Database, { store: context }))
  );

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes;
        const initialMessage = { text: 'First saved note' };
        const note = yield* notes.createUntitledNote({ initialMessage });

        expect((yield* notes.notes({ limit: 100 })).items.map((item) => item.id)).toStrictEqual([
          note.id
        ]);
        const thread = yield* notes.thread({ noteId: note.id, limit: 100 });

        assert.strictEqual(thread.items.length, 1);
        assert.ok(thread.items[0]?.versions.at(-1)?.text === 'First saved note');
        assert.ok(
          (yield* Effect.flip(
            notes.createUntitledNote({
              initialMessage: { text: ' ' }
            })
          )).kind === 'invalid_input'
        );
        assert.strictEqual((yield* notes.notes({ limit: 100 })).items.length, 1);
      }).pipe(Effect.provide(layer))
    );
  } finally {
    context.close();
    await location.cleanup();
  }
});
