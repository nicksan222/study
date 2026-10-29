import { Schema } from 'effect';

export const outputSchema = Schema.String;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
