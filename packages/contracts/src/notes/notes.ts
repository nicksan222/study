import { Schema } from 'effect';

import { noteIdSchema, recordingIdSchema } from '../ids.ts';
import type { noteSchema, titleSourceSchema } from './schemas.ts';

export type TitleSource = typeof titleSourceSchema.Type;

export type Note = typeof noteSchema.Type;

/** Internal transaction participants copy content into the same new notebook. */
export const copyNoteContentSchema = Schema.Struct({
  noteIds: Schema.Array(noteIdSchema).check(Schema.isBetweenLength(2, 20)),
  targetNoteId: noteIdSchema
});

export const recordingCopySchema = Schema.Struct({
  originalId: recordingIdSchema,
  copiedId: recordingIdSchema
});
