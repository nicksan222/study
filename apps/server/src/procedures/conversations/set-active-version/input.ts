import { Schema } from 'effect';

export const inputSchema = Schema.Struct({
  message: Schema.BigInt.check(
    Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
  ),
  version: Schema.BigInt.check(
    Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
  )
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
