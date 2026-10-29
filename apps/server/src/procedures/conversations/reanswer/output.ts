import { Schema } from 'effect';

export const outputSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('unavailable') }),
  Schema.Struct({ type: Schema.Literal('busy') }),
  Schema.Struct({ type: Schema.Literal('queued'), jobId: Schema.BigInt })
]);

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
