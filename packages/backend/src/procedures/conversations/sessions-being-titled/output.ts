import { Schema } from 'effect';

export const outputSchema = Schema.Struct({ items: Schema.mutable(Schema.Array(Schema.BigInt)) });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
