import { Schema } from 'effect';

import { recordingIdSchema, sessionIdSchema, sourceIdSchema, messageIdSchema } from '../ids.ts';

export const recordingSchema = Schema.Struct({
  id: recordingIdSchema,
  sessionId: sessionIdSchema,
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
  sessionId: sessionIdSchema,
  sourceId: Schema.NullOr(sourceIdSchema),
  messageId: Schema.NullOr(messageIdSchema)
});
