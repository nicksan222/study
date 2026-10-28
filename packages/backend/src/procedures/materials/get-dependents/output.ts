import { Schema } from 'effect';

import { materialIdSchema, materialVersionSummarySchema } from '#backend/shared/materials/schemas';

export const outputSchema = Schema.Struct({
  items: Schema.mutable(Schema.Array(materialVersionSummarySchema)),
  nextCursor: Schema.NullOr(materialIdSchema)
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
