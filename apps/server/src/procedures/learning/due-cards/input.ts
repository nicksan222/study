import { Schema } from 'effect';

import {
  learningIdSchema,
  learningTakeSchema,
  learningTimeSchema
} from '#server/shared/learning/schemas';

export const inputSchema = Schema.Struct({
  projectId: learningIdSchema,
  before: Schema.optional(learningTimeSchema),
  take: learningTakeSchema,
  cursor: Schema.optional(Schema.Struct({ due: learningTimeSchema, cardId: learningIdSchema }))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
