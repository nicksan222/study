import { Schema } from 'effect';

import { materialIdSchema } from '#server/shared/materials/schemas';

export const inputSchema = Schema.Struct({
  id: materialIdSchema,
  title: Schema.Trim.check(Schema.isBetweenLength(1, 200))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
