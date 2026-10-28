import { Schema } from 'effect';

const idSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const inputSchema = Schema.Struct({
  id: idSchema,
  answer: Schema.Union([
    Schema.Struct({
      type: Schema.Literal('choice'),
      choice: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
    }),
    Schema.Struct({
      type: Schema.Literal('open'),
      answer: Schema.String.check(Schema.isMinLength(1))
    })
  ])
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
