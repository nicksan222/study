import { Effect, Schema } from 'effect';

export const inputSchema = Schema.Struct({}).pipe(Schema.withDecodingDefault(Effect.succeed({})));

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
