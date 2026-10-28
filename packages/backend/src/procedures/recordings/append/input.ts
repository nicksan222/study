import { Schema } from 'effect';

const idSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const inputSchema = Schema.Struct({
  id: idSchema,
  samples: Schema.mutable(
    Schema.Array(
      Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: -32768, maximum: 32767 }))
    )
  ).check(Schema.isMinLength(1), Schema.isMaxLength(960000))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
