import { Schema } from 'effect';

import { materialItemSchema } from '#server/shared/material/schemas';

export const outputSchema = Schema.Struct({
  items: Schema.mutable(Schema.Array(materialItemSchema))
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
