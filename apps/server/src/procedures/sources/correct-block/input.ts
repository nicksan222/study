import { Schema, Effect } from 'effect';

const idSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const inputSchema = Schema.Struct({
  id: idSchema,
  ordinal: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 0, maximum: 1000000 })
  ).pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  before: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(''))),
  after: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(''))),
  documentId: idSchema
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
