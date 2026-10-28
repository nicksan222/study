import { Schema } from 'effect';

import { learningIdSchema, learningTakeSchema } from '#backend/shared/learning/schemas';

export const inputSchema = Schema.Struct({
  versionId: learningIdSchema,
  cardId: learningIdSchema,
  take: learningTakeSchema,
  cursor: Schema.optional(learningIdSchema)
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
