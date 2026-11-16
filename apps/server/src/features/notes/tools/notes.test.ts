import { test } from '@study/testing';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies notebook tools reuse named notes and protect Assistant notes.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Tests exact-name reuse, pagination, subject memberships and history through services.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses isolated SQLite fixtures and real feature services.                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { Effect } from 'effect';

import { Notes } from '#server/features/notes/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';

import { noteTools } from './notes.ts';
import { subjectTools } from './subjects.ts';

const environment = { language: 'en', searchSources: () => Effect.succeed([]) };

test.stable(
  'notebook tools scope exact-name retries, page history and preserve memberships',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const subject = yield* subjectTools.create_subject.execute(
            { name: 'Biology' },
            environment
          );
          const first = yield* noteTools.create_note.execute({ title: ' Revision ' }, environment);
          const service = yield* Notes;

          // The reusable note must be found beyond the first page.
          for (let i = 0; i < 100; i++) yield* service.createNote({ title: `Other ${i}` });

          const retry = yield* noteTools.create_note.execute({ title: 'Revision' }, environment);

          test.expect(retry.id).toBe(first.id);
          const scoped = yield* noteTools.create_note.execute(
            { title: 'Revision', project: subject.id },
            environment
          );

          test.expect(scoped.id).not.toBe(first.id);
          test
            .expect(
              (yield* noteTools.create_note.execute(
                { title: 'Revision', project: subject.id },
                environment
              )).id
            )
            .toBe(scoped.id);
          yield* noteTools.link_note_subject.execute(
            { noteId: first.id, projectId: subject.id },
            environment
          );
          yield* noteTools.link_note_subject.execute(
            { noteId: first.id, projectId: subject.id },
            environment
          );
          test
            .expect((yield* noteTools.read_note.execute({ id: first.id }, environment)).projectIds)
            .toStrictEqual([subject.id]);
          yield* noteTools.unlink_note_subject.execute(
            { noteId: first.id, projectId: subject.id },
            environment
          );
          test
            .expect((yield* noteTools.read_note.execute({ id: first.id }, environment)).projectIds)
            .toStrictEqual([]);
          yield* service.postMessage({ noteId: first.id, text: 'First note' });
          yield* service.postMessage({ noteId: first.id, text: 'Second note' });
          const page = yield* noteTools.read_note_history.execute(
            { noteId: first.id, limit: 1 },
            environment
          );

          test.assert.ok(page.next);
          const older = yield* noteTools.read_note_history.execute(
            { noteId: first.id, limit: 1, before: page.next },
            environment
          );

          test.expect(older.items).toHaveLength(1);
          test.expect(older.items[0].id).not.toBe(page.items[0].id);
          test.expect(older.next).toBeNull();
          test
            .expect(
              (yield* noteTools.rename_note.execute(
                { id: first.id, title: 'Exam review' },
                environment
              )).title
            )
            .toBe('Exam review');
          const assistant = yield* service.assistantNote();

          for (const operation of [
            noteTools.read_note.execute({ id: assistant.id }, environment).pipe(Effect.asVoid),
            noteTools.rename_note
              .execute({ id: assistant.id, title: 'Wrong' }, environment)
              .pipe(Effect.asVoid),
            noteTools.read_note_history
              .execute({ noteId: assistant.id, limit: 10 }, environment)
              .pipe(Effect.asVoid),
            noteTools.link_note_subject
              .execute({ noteId: assistant.id, projectId: subject.id }, environment)
              .pipe(Effect.asVoid)
          ])
            test.expect((yield* Effect.flip(operation)).kind).toBe('not_found');
        }).pipe(Effect.provide(Notes.layer), Effect.provideService(Database, { store: context }))
      );
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
