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

import { NoteMode } from '@study/contracts/notes/schemas';
import { eq } from '@study/db';
import { notes, projects, project_notes } from '@study/db/schema';
import { createTestDatabase } from '@study/db/testing';
import { testStable } from '@study/testing/vitest';
import { Effect, Option } from 'effect';
import { assert, expect } from 'vite-plus/test';

import { NoteStore } from '#server/features/notes/store/index';
import { ServerContext } from '#server/platform/database/context';
import { Database } from '#server/platform/database/database';
import { transaction } from '#server/platform/definitions/define-store';

import { ensureNote } from './ensure-note.ts';

testStable(
  'named notebook lookup uses exact titles, active notebooks, earliest IDs and collection scope',
  async () => {
    const location = await createTestDatabase();
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

      assert.ok(firstProject);
      assert.ok(secondProject);

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

          expect(Option.getOrUndefined(store.findNotebookByTitle({ title: 'Biology' }))?.id).toBe(
            earliest.id
          );
          expect(
            Option.getOrUndefined(
              store.findNotebookByTitle({ title: 'Biology', project: firstProject.id })
            )?.id
          ).toBe(firstOnly.id);
          expect(
            Option.getOrUndefined(
              store.findNotebookByTitle({ title: 'Biology', project: secondProject.id })
            )?.projectIds
          ).toEqual([firstProject.id, secondProject.id]);
          expect(Option.getOrUndefined(store.findNotebookByTitle({ title: 'biology' }))?.id).toBe(
            lowerCase.id
          );
          expect(Option.isNone(store.findNotebookByTitle({ title: 'BIOLOGY' }))).toBe(true);
          expect(
            store
              .notes({ limit: 100, before: { updatedAt: 999n, id: lowerCase.id } })
              .some((note) => note.id === collected.id)
          ).toBe(true);
          expect(
            store
              .notes({ limit: 100, before: { updatedAt: 999n, id: lowerCase.id }, project: null })
              .some((note) => note.id === collected.id)
          ).toBe(false);
        })
      );

      expect((await run(ensureNote({ title: '  Biology  ' }))).id).toBe(earliest.id);
      expect((await run(ensureNote({ title: 'Biology', project: firstProject.id }))).id).toBe(
        firstOnly.id
      );
      expect((await run(ensureNote({ title: 'Biology', project: secondProject.id }))).id).toBe(
        collected.id
      );
      const created = await run(ensureNote({ title: '  New title  ', project: secondProject.id }));

      expect(created.title).toBe('New title');
      expect(created.titleSource).toBe('user');
      expect((await run(ensureNote({ title: 'New title', project: secondProject.id }))).id).toBe(
        created.id
      );
      expect(
        context.db.orm.select().from(notes).where(eq(notes.title, 'New title')).all()
      ).toHaveLength(1);
      await expect(run(ensureNote({ title: '   ' }))).rejects.toMatchObject({
        kind: 'invalid_input'
      });
    } finally {
      context.close();
      await location.cleanup();
    }
  }
);
