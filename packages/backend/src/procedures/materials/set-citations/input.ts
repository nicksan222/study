import { Schema } from 'effect';

import { materialCitationSchema, materialIdSchema } from '#backend/shared/materials/schemas';

export const inputSchema = Schema.Struct({
  id: materialIdSchema,
  citations: Schema.mutable(Schema.Array(materialCitationSchema)).check(Schema.isMaxLength(10000))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
