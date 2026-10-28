import { Schema } from 'effect';

export const outputSchema = Schema.Undefined;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
