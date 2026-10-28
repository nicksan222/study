import { Schema } from 'effect';

const idSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const inputSchema = Schema.Struct({
  projectId: idSchema,
  sessionId: Schema.optional(idSchema),
  url: Schema.Trim,
  title: Schema.optional(Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(200)))
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
