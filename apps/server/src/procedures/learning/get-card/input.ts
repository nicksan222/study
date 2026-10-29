import { Schema } from 'effect';

import { learningIdSchema } from '#server/shared/learning/schemas';

export const inputSchema = Schema.Struct({
  versionId: learningIdSchema,
  cardId: learningIdSchema
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
