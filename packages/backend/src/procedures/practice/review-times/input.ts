import { Effect, Schema } from 'effect';

const idSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const inputSchema = Schema.Struct({
  project: Schema.optional(Schema.NullOr(idSchema)),
  since: Schema.BigInt.pipe(Schema.withDecodingDefault(Effect.succeed(0n)))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
