import { Schema } from 'effect';

import { sessionIdSchema } from '../ids.ts';
import { executionCursorSchema, executionSchema } from '../workflows/schemas.ts';

export const sessionWorkKindSchema = Schema.Literals(['transform', 'reply', 'attachment', 'title']);

export const sessionWorkInputSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(executionCursorSchema)
});

export const sessionWorkItemSchema = Schema.Struct({
  kind: sessionWorkKindSchema,
  title: Schema.NullOr(Schema.String),
  requestId: Schema.String,
  execution: executionSchema
});

export const sessionWorkPageSchema = Schema.Struct({
  items: Schema.Array(sessionWorkItemSchema),
  next: Schema.NullOr(executionCursorSchema)
});
