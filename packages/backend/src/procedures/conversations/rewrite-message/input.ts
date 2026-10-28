import { Schema } from 'effect';

export const inputSchema = Schema.Struct({
  id: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })),
  how: Schema.Union([
    Schema.Struct({ type: Schema.Literal('improve') }),
    Schema.Struct({ type: Schema.Literal('summarize') }),
    Schema.Struct({
      type: Schema.Literal('instruction'),
      instruction: Schema.String.check(Schema.isMinLength(1))
    })
  ])
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
