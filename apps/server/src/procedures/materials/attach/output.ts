import { Schema } from 'effect';

import { materialIdSchema } from '#server/shared/materials/schemas';

export const outputSchema = Schema.Struct({
  sessionId: materialIdSchema,
  materialId: materialIdSchema
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
