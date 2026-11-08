import { Schema } from 'effect';

import { recordingIdSchema, noteIdSchema, sourceIdSchema, messageIdSchema } from '../ids.ts';

export const recordingSchema = Schema.Struct({
  id: recordingIdSchema,
  noteId: noteIdSchema,
  startedAt: Schema.BigInt,
  updatedAt: Schema.BigInt
});

export const recordingViewSchema = Schema.Struct({
  ...recordingSchema.fields,
  samples: Schema.BigInt
});

export const recordingPostSchema = Schema.Struct({
  requestId: Schema.String.check(Schema.isMinLength(1)),
  recordingId: recordingIdSchema,
  noteId: noteIdSchema,
  sourceId: Schema.NullOr(sourceIdSchema),
  messageId: Schema.NullOr(messageIdSchema)
});
