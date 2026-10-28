import { Schema } from 'effect';

import { learningIdSchema, learningRatingSchema } from '#backend/shared/learning/schemas';

export const inputSchema = Schema.Struct({
  versionId: learningIdSchema,
  cardId: learningIdSchema,
  rating: learningRatingSchema
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
