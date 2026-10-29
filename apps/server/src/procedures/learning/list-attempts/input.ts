import { Schema } from 'effect';

import { learningIdSchema, learningTakeSchema } from '#server/shared/learning/schemas';

export const inputSchema = Schema.Struct({
  projectId: Schema.optional(learningIdSchema),
  materialId: Schema.optional(learningIdSchema),
  cursor: Schema.optional(learningIdSchema),
  take: learningTakeSchema
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
