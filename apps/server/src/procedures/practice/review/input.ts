import { Schema } from 'effect';

const idSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const inputSchema = Schema.Struct({
  card: idSchema,
  rating: Schema.Literals([1, 2, 3, 4])
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
