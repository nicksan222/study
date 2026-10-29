import { Schema } from 'effect';

import { materialIdSchema } from '#server/shared/materials/schemas';

export const inputSchema = Schema.Struct({
  sessionId: materialIdSchema,
  materialIds: Schema.mutable(Schema.Array(materialIdSchema)).check(Schema.isMaxLength(10000))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
