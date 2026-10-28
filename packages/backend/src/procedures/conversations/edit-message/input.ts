import { Effect, Schema } from 'effect';

export const inputSchema = Schema.Struct({
  id: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })),
  text: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed('')))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
