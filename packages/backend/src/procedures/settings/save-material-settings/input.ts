import { Effect, Schema } from 'effect';

export const inputSchema = Schema.Struct({
  sift: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false)))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
