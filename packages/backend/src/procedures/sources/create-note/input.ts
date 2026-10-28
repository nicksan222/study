import { Schema, Effect } from 'effect';

const idSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const inputSchema = Schema.Struct({
  project: Schema.optional(Schema.NullOr(idSchema)),
  title: Schema.String,
  text: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed('')))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
