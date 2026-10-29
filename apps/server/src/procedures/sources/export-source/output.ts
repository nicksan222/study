import { Schema } from 'effect';

export const outputSchema = Schema.Struct({ value: Schema.Uint8Array });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
