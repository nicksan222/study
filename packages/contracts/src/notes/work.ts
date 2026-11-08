import { Schema } from 'effect';

import { noteIdSchema } from '../ids.ts';
import { executionCursorSchema, executionSchema } from '../workflows/schemas.ts';

export const noteWorkKindSchema = Schema.Literals(['transform', 'reply', 'attachment', 'title']);

export const noteWorkInputSchema = Schema.Struct({
  noteId: noteIdSchema,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(executionCursorSchema)
});

export const noteWorkItemSchema = Schema.Struct({
  kind: noteWorkKindSchema,
  title: Schema.NullOr(Schema.String),
  requestId: Schema.String,
  execution: executionSchema
});

export const noteWorkPageSchema = Schema.Struct({
  items: Schema.Array(noteWorkItemSchema),
  next: Schema.NullOr(executionCursorSchema)
});
