import { Schema } from 'effect';

export const inputSchema = Schema.Struct({
  project: Schema.BigInt.check(
    Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
  ),
  title: Schema.String
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
