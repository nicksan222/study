import { Schema } from 'effect';

export const outputSchema = Schema.Struct({ type: Schema.Literal('queued'), jobId: Schema.BigInt });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
