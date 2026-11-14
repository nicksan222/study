/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines note persistence stores and their typed queries and mutations.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports typed store definitions consumed by the note service.                          │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the notes service applies policy and            │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { ProjectId } from '@study/contracts/ids';
import { noteIdSchema } from '@study/contracts/ids';
import {
  createNoteInputSchema,
  renameNoteInputSchema,
  notePageInputSchema
} from '@study/contracts/notes/rpc';
import { NoteMode, noteModeSchema, noteSchema } from '@study/contracts/notes/schemas';
import { and, asc, desc, eq, lt, or, sql } from '@study/db';
import {
  notes,
  projects,
  project_notes,
  messages,
  recordings,
  note_pages,
  note_run_contexts,
  note_deletions
} from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';

const projectMembership = (project: ProjectId | null | undefined) =>
  project === undefined
    ? undefined
    : project === null
      ? sql`NOT EXISTS (SELECT 1 FROM ${project_notes} WHERE ${project_notes.note_id} = ${notes.id})`
      : sql`EXISTS (SELECT 1 FROM ${project_notes} WHERE ${project_notes.note_id} = ${notes.id} AND ${project_notes.project_id} = ${project})`;

const resolvedMode = (mode: NoteMode | undefined) => mode ?? NoteMode.Notebook;

const row = (
  value: typeof notes.$inferSelect,
  projectIds: readonly (typeof projects.$inferSelect.id)[]
) => ({
  projectIds,
  id: value.id,
  title: value.title,
  titleSource: value.title_source,
  archivedAt: value.archived_at,
  createdAt: value.created_at,
  updatedAt: value.updated_at
});

export const NoteStore = defineStore({
  name: 'study/NoteNoteStore',
  entity: { singular: 'note', plural: 'notes' },
  make: ({ db, timestampClock }) => {
    const present = (value: typeof notes.$inferSelect) =>
      row(
        value,
        db.orm
          .select()
          .from(project_notes)
          .where(eq(project_notes.note_id, value.id))
          .all()
          .map((link) => link.project_id)
      );

    return {
      queries: {
        note: storeQuery({
          role: 'required',
          input: noteIdSchema,
          output: noteSchema,
          run: (id) => {
            const value = db.orm.select().from(notes).where(eq(notes.id, id)).get();

            return value ? present(value) : null;
          }
        }),
        findNote: storeQuery({
          role: 'optional',
          input: noteIdSchema,
          output: Schema.Option(noteSchema),
          run: (id) =>
            Option.fromNullishOr(db.orm.select().from(notes).where(eq(notes.id, id)).get()).pipe(
              Option.map(present)
            )
        }),
        findNotebookByTitle: storeQuery({
          role: 'optional',
          input: createNoteInputSchema,
          output: Schema.Option(noteSchema),
          run: (input) =>
            Option.fromNullishOr(
              db.orm
                .select()
                .from(notes)
                .where(
                  and(
                    eq(notes.title, input.title),
                    eq(notes.mode, NoteMode.Notebook),
                    sql`${notes.archived_at} IS NULL`,
                    projectMembership(input.project ?? null)
                  )
                )
                .orderBy(asc(notes.id))
                .limit(1)
                .get()
            ).pipe(Option.map(present))
        }),
        notes: storeQuery({
          role: 'collection',
          input: notePageInputSchema,
          output: Schema.Array(noteSchema),
          run: (input) =>
            db.orm
              .select()
              .from(notes)
              .where(
                and(
                  eq(notes.mode, NoteMode.Notebook),
                  projectMembership(input.project),
                  input.before === undefined
                    ? undefined
                    : or(
                        lt(notes.updated_at, input.before.updatedAt),
                        and(
                          eq(notes.updated_at, input.before.updatedAt),
                          lt(notes.id, input.before.id)
                        )
                      )
                )
              )
              .orderBy(desc(notes.updated_at), desc(notes.id))
              .limit(input.limit)
              .all()
              .map(present)
        })
      },
      mutations: {
        createNote: storeMutation({
          input: Schema.Struct({
            ...createNoteInputSchema.fields,
            titleSource: Schema.Literals(['user', 'provisional']),
            mode: Schema.optional(noteModeSchema)
          }),
          output: noteSchema,
          run: (input) => {
            const mode = resolvedMode(input.mode);
            const title = input.title.trim();

            if (!title || [...title].length > 200)
              throw new StudyError('invalid_input', 'invalid note title');

            const now = unixSeconds(timestampClock);

            if (
              input.project !== undefined &&
              !db.orm.select().from(projects).where(eq(projects.id, input.project)).get()
            )
              throw new StudyError('not_found', 'Collection not found');

            // This lookup and insertion share the caller's immediate transaction.
            // A provisional title alone does not make a note with work reusable.
            const draft =
              input.titleSource === 'provisional'
                ? db.orm
                    .select()
                    .from(notes)
                    .where(
                      and(
                        eq(notes.title_source, 'provisional'),
                        sql`${notes.archived_at} IS NULL`,
                        eq(notes.mode, mode),
                        sql`json_array_length(${notes.selection}) = 0`,
                        sql`NOT EXISTS (SELECT 1 FROM ${messages} WHERE ${messages.note_id} = ${notes.id})`,
                        sql`NOT EXISTS (SELECT 1 FROM ${recordings} WHERE ${recordings.note_id} = ${notes.id})`,
                        sql`NOT EXISTS (SELECT 1 FROM ${note_pages} WHERE ${note_pages.note_id} = ${notes.id})`,
                        sql`NOT EXISTS (SELECT 1 FROM ${note_run_contexts} WHERE ${note_run_contexts.note_id} = ${notes.id})`,
                        sql`NOT EXISTS (SELECT 1 FROM ${note_deletions} WHERE ${note_deletions.note_id} = ${notes.id})`
                      )
                    )
                    .orderBy(desc(notes.id))
                    .get()
                : undefined;

            if (draft) {
              db.orm.delete(project_notes).where(eq(project_notes.note_id, draft.id)).run();

              if (input.project !== undefined)
                db.orm
                  .insert(project_notes)
                  .values({ project_id: input.project, note_id: draft.id })
                  .run();

              const reused = db.orm
                .update(notes)
                .set({ title, updated_at: now })
                .where(eq(notes.id, draft.id))
                .returning()
                .get();

              if (!reused) throw new StudyError('not_found', 'note not found');

              return present(reused);
            }

            const created = db.orm
              .insert(notes)
              .values({
                title,
                title_source: input.titleSource,
                mode: mode,
                created_at: now,
                updated_at: now
              })
              .returning()
              .get();

            if (input.project !== undefined)
              db.orm
                .insert(project_notes)
                .values({ project_id: input.project, note_id: created.id })
                .run();

            return present(created);
          }
        }),
        renameNote: storeMutation({
          input: renameNoteInputSchema,
          output: noteSchema,
          run: (input) => {
            const title = input.title.trim();

            if (!title || [...title].length > 200)
              throw new StudyError('invalid_input', 'invalid note title');

            const updated = db.orm
              .update(notes)
              .set({
                title,
                title_source: 'user',
                context_revision: sql`${notes.context_revision} + 1`,
                updated_at: unixSeconds(timestampClock)
              })
              .where(eq(notes.id, input.id))
              .returning()
              .get();

            if (!updated) throw new StudyError('not_found', 'note not found');

            return present(updated);
          }
        })
      }
    };
  }
});
