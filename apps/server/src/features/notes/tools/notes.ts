/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes notebook note tools and their agent usage guides.                          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reuses canonical feature services and schema-checked operations.                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Persistence policy remains in the owning feature service.                                │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import * as r from '@study/contracts/notes/rpc';
import { noteSchema } from '@study/contracts/notes/schemas';
import * as p from '@study/contracts/projects/rpc';
import { Effect, Schema } from 'effect';

import { Notes } from '#server/features/notes/index';
import { Projects } from '#server/features/projects/index';
import { defineTool } from '#server/platform/definitions/define-agent';

export const noteTools = {
  list_notes: defineTool({
    description: 'List notebook notes with optional subject membership filter.',
    wiki: {
      when: 'Find study notes and resolve their IDs.',
      examples: ['Show my biology study notes.'],
      limits:
        'At most 100 per page. Pass next as before until null. Omit project for all notebooks; project=null finds unassigned notebooks. Assistant chats are separate.'
    },
    input: r.notePageInputSchema,
    output: r.notePageSchema,
    mutates: false,
    execute: (input: typeof r.notePageInputSchema.Type) =>
      Notes.use((service) => service.notes(input)).pipe(Effect.provide(Notes.layer))
  }),
  read_note: defineTool({
    description: 'Read a notebook note title and subject memberships.',
    wiki: {
      when: 'Inspect a known note before changing it.',
      examples: ['Which subjects is this note linked to?'],
      limits:
        'Requires an exact listed note ID. Use read_note_history for messages and list_pages for linked pages.'
    },
    input: r.noteIdInputSchema,
    output: noteSchema,
    mutates: false,
    execute: (input: typeof r.noteIdInputSchema.Type) =>
      Notes.use((service) => service.notebookNote(input.id)).pipe(Effect.provide(Notes.layer))
  }),
  create_note: defineTool({
    description: 'Create a named notebook note or reuse an exact name in the same subject.',
    wiki: {
      when: 'The user asks to create a study note.',
      examples: ['Create a note called Exam revision in Biology.'],
      limits:
        'Title must contain 1–200 characters after trimming. Reuses the earliest notebook with the same exact name and requested subject (or no subject), so retries do not duplicate it. Does not start model work or create messages.'
    },
    input: r.createNoteInputSchema,
    output: noteSchema,
    mutates: true,
    execute: (input: typeof r.createNoteInputSchema.Type) =>
      Notes.use((service) => service.ensureNote(input)).pipe(Effect.provide(Notes.layer))
  }),
  rename_note: defineTool({
    description: 'Rename an existing notebook note.',
    wiki: {
      when: 'The user asks to change a note title.',
      examples: ['Rename this note to Week 2 revision.'],
      limits:
        'Resolve the exact note ID first. Title must contain 1–200 characters. Preserves history and linked content.'
    },
    input: r.renameNoteInputSchema,
    output: noteSchema,
    mutates: true,
    execute: (input: typeof r.renameNoteInputSchema.Type) =>
      Notes.use((service) =>
        service.notebookNote(input.id).pipe(Effect.andThen(service.renameNote(input)))
      ).pipe(Effect.provide(Notes.layer))
  }),
  read_note_history: defineTool({
    description: 'Read a page of saved messages in a notebook note or thread.',
    wiki: {
      when: 'Review notes, questions and replies from a note.',
      examples: ['What did we cover in my last biology note?'],
      limits:
        'At most 100 messages per page. Pass next as before for older messages until null. Read each message’s activeVersionId to identify its current text; message versions are historical variants. Optional threadRoot restricts a thread. Does not include linked page bodies.'
    },
    input: r.threadInputSchema,
    output: r.threadPageSchema,
    mutates: false,
    execute: (input: typeof r.threadInputSchema.Type) =>
      Notes.use((service) =>
        service.notebookNote(input.noteId).pipe(Effect.andThen(service.thread(input)))
      ).pipe(Effect.provide(Notes.layer))
  }),
  link_note_subject: membershipTool(
    'Link a notebook note to a subject.',
    'Link this note to Biology.',
    true
  ),
  unlink_note_subject: membershipTool(
    'Unlink a notebook note from a subject.',
    'Unlink this note from Biology.',
    false
  )
} as const;

function membershipTool(description: string, example: string, add: boolean) {
  return defineTool({
    description,
    wiki: {
      when: 'Change which subjects contain a note.',
      examples: [example],
      limits:
        'Resolve both exact IDs first. Notes may belong to several subjects. Preserves messages and pages; retries are safe.'
    },
    input: p.projectNoteInputSchema,
    output: Schema.Boolean,
    mutates: true,
    execute: (input) =>
      Effect.gen(function* () {
        const notes = yield* Notes;

        yield* notes.notebookNote(input.noteId);
        const projects = yield* Projects;

        yield* add ? projects.addNote(input) : projects.removeNote(input);

        return true;
      }).pipe(Effect.provide(Projects.layer), Effect.provide(Notes.layer))
  });
}
