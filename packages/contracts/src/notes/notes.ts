import { Schema } from 'effect';

import { noteIdSchema, recordingIdSchema, versionIdSchema } from '../ids.ts';
import type { noteSchema } from './schemas.ts';

export type Note = typeof noteSchema.Type;

/** Reserved capture key for the message that carries the notebook body. */
export const notebookBodyCaptureKey = 'notebook-body/v1';

export const noteBodyInputSchema = Schema.Struct({ noteId: noteIdSchema });

export const noteBodySchema = Schema.Struct({
  text: Schema.String,
  versionId: Schema.NullOr(versionIdSchema)
});

export const saveNoteBodyInputSchema = Schema.Struct({
  ...noteBodyInputSchema.fields,
  text: Schema.String,
  expectedVersionId: Schema.NullOr(versionIdSchema)
});

/** Internal transaction participants copy content into the same new notebook. */
export const copyNoteContentSchema = Schema.Struct({
  noteIds: Schema.Array(noteIdSchema).check(Schema.isBetweenLength(2, 20)),
  targetNoteId: noteIdSchema
});

export const recordingCopySchema = Schema.Struct({
  originalId: recordingIdSchema,
  copiedId: recordingIdSchema
});
