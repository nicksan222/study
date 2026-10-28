import { Schema } from 'effect';

export const outputSchema = Schema.Struct({
  value: Schema.Boolean
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
