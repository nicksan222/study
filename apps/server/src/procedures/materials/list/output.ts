import { Schema } from 'effect';

import { materialIdSchema, materialSummarySchema } from '#server/shared/materials/schemas';

export const outputSchema = Schema.Struct({
  items: Schema.mutable(Schema.Array(materialSummarySchema)),
  nextCursor: Schema.NullOr(materialIdSchema)
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
