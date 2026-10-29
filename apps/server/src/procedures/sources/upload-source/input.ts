import { Schema } from 'effect';

const idSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const inputSchema = Schema.Struct({
  name: Schema.String,
  bytes: Schema.Uint8Array,
  project: Schema.optional(Schema.NullOr(idSchema))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
