import { Schema } from 'effect';

import { practiceSummarySchema } from '#backend/shared/practice/schemas';

export const outputSchema = Schema.Struct({
  items: Schema.mutable(Schema.Array(practiceSummarySchema))
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
