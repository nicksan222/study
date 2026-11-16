import { NoteMode } from '@study/contracts';
/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Verifies exact named notebook reuse against real SQLite.                           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Covers title matching, collection scopes, and retry reuse.                             │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses production stores and transactions with an isolated database.                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */
import { eq } from '@study/db';
import { notes, projects, project_notes } from '@study/db';
import { test } from '@study/testing';
import { Effect, Option } from 'effect';

import { NoteStore } from '#server/features/notes/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';

import { ensureNote } from './ensure-note.ts';

test.stable(
  'named notebook lookup uses exact titles, active notebooks, earliest IDs and collection scope',
  async ({ databases }) => {
    const location = await databases();
    const context = new ServerContext(await location.open());
    const run = <A, E>(effect: Effect.Effect<A, E, Database>) =>
      Effect.runPromise(effect.pipe(Effect.provideService(Database, { store: context })));

    try {
      const [firstProject, secondProject] = context.db.orm
        .insert(projects)
        .values([
          { name: 'First', created_at: 1n, updated_at: 1n },
          { name: 'Second', created_at: 1n, updated_at: 1n }
        ])
        .returning()
        .all();

      test.assert.ok(firstProject);
      test.assert.ok(secondProject);

      const insert = (title: string, extra: Partial<typeof notes.$inferInsert> = {}) =>
        context.db.orm
          .insert(notes)
          .values({ title, title_source: 'user', created_at: 1n, updated_at: 1n, ...extra })
          .returning()
          .get();

      insert('Biology', { mode: NoteMode.Assistant });
      insert('Biology', { archived_at: 2n });
      const firstOnly = insert('Biology');

      context.db.orm
        .insert(project_notes)
        .values({ note_id: firstOnly.id, project_id: firstProject.id })
        .run();
      const collected = insert('Biology');

      context.db.orm
        .insert(project_notes)
        .values([
          { note_id: collected.id, project_id: firstProject.id },
          { note_id: collected.id, project_id: secondProject.id }
        ])
        .run();
      const earliest = insert('Biology', { updated_at: 2n });

      insert('Biology', { updated_at: 999n });
      const lowerCase = insert('biology');

      for (let i = 0; i < 105; i++) insert(`Decoy ${i}`, { updated_at: 1000n });

      await run(
        transaction((tx) => {
          const store = tx.store(NoteStore);

          test
            .expect(Option.getOrUndefined(store.findNotebookByTitle({ title: 'Biology' }))?.id)
            .toBe(earliest.id);
          test
            .expect(
              Option.getOrUndefined(
                store.findNotebookByTitle({ title: 'Biology', project: firstProject.id })
              )?.id
            )
            .toBe(firstOnly.id);
          test
            .expect(
              Option.getOrUndefined(
                store.findNotebookByTitle({ title: 'Biology', project: secondProject.id })
              )?.projectIds
            )
            .toEqual([firstProject.id, secondProject.id]);
          test
            .expect(Option.getOrUndefined(store.findNotebookByTitle({ title: 'biology' }))?.id)
            .toBe(lowerCase.id);
          test.expect(Option.isNone(store.findNotebookByTitle({ title: 'BIOLOGY' }))).toBe(true);
          test
            .expect(
              store
                .notes({ limit: 100, before: { updatedAt: 999n, id: lowerCase.id } })
                .some((note) => note.id === collected.id)
            )
            .toBe(true);
          test
            .expect(
              store
                .notes({ limit: 100, before: { updatedAt: 999n, id: lowerCase.id }, project: null })
                .some((note) => note.id === collected.id)
            )
            .toBe(false);
        })
      );

      test.expect((await run(ensureNote({ title: '  Biology  ' }))).id).toBe(earliest.id);
      test
        .expect((await run(ensureNote({ title: 'Biology', project: firstProject.id }))).id)
        .toBe(firstOnly.id);
      test
        .expect((await run(ensureNote({ title: 'Biology', project: secondProject.id }))).id)
        .toBe(collected.id);
      const created = await run(ensureNote({ title: '  New title  ', project: secondProject.id }));

      test.expect(created.title).toBe('New title');
      test.expect(created.titleSource).toBe('user');
      test
        .expect((await run(ensureNote({ title: 'New title', project: secondProject.id }))).id)
        .toBe(created.id);
      test
        .expect(context.db.orm.select().from(notes).where(eq(notes.title, 'New title')).all())
        .toHaveLength(1);
      await test.expect(run(ensureNote({ title: '   ' }))).rejects.toMatchObject({
        kind: 'invalid_input'
      });
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
