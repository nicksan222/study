import { Schema } from 'effect';

import { messageIdSchema, noteIdSchema, sourceIdSchema, pageIdSchema } from '../ids.ts';

/** Archive state belongs to a note membership, never to another note's shared original. */
const noteArchiveTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('message'), id: messageIdSchema }),
  Schema.Struct({ kind: Schema.Literal('page'), id: pageIdSchema }),
  Schema.Struct({ kind: Schema.Literal('source'), id: sourceIdSchema })
]);

export const noteArchiveInputSchema = Schema.Struct({ noteId: noteIdSchema });

export const setNoteItemArchivedSchema = Schema.Struct({
  ...noteArchiveInputSchema.fields,
  target: noteArchiveTargetSchema,
  archived: Schema.Boolean
});

export const archivedNoteItemSchema = Schema.Struct({
  target: noteArchiveTargetSchema,
  name: Schema.String,
  archivedAt: Schema.BigInt
});

export type NoteArchiveTarget = typeof noteArchiveTargetSchema.Type;

export type ArchivedNoteItem = typeof archivedNoteItemSchema.Type;
