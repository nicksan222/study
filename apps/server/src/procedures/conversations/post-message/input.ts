import { Effect, Schema } from 'effect';

export const inputSchema = Schema.Struct({
  place: Schema.Union([
    Schema.Struct({
      type: Schema.Literal('timeline'),
      id: Schema.BigInt.check(
        Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
      )
    }),
    Schema.Struct({
      type: Schema.Literal('thread'),
      id: Schema.BigInt.check(
        Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
      )
    })
  ]),
  text: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(''))),
  files: Schema.mutable(Schema.Array(Schema.String))
    .check(Schema.isMaxLength(100))
    .pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  attachments: Schema.mutable(
    Schema.Array(
      Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n }))
    )
  )
    .check(Schema.isMaxLength(100))
    .pipe(Schema.withDecodingDefault(Effect.succeed([])))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
