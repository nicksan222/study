import { Effect, Schema } from 'effect';

export const inputSchema = Schema.Struct({
  limit: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 10000 })).pipe(
    Schema.withDecodingDefault(Effect.succeed(0))
  )
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
