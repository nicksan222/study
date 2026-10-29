import { Schema } from 'effect';

import { materialIdSchema } from '#server/shared/materials/schemas';

export const inputSchema = Schema.Struct({
  sessionId: materialIdSchema,
  materialId: materialIdSchema
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
