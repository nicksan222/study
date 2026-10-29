import { Schema } from 'effect';

const idSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

const naturalSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 0n, maximum: 9223372036854775807n })
);

const positiveSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

const optionalNaturalSchema = Schema.optional(Schema.NullOr(naturalSchema));

const optionalPositiveSchema = Schema.optional(Schema.NullOr(positiveSchema));

export const inputSchema = Schema.Struct({
  projectId: idSchema,
  sessionId: Schema.optional(idSchema),
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  bytes: Schema.Uint8Array,
  durationMs: optionalNaturalSchema,
  sampleRate: optionalPositiveSchema,
  channels: optionalPositiveSchema,
  width: optionalPositiveSchema,
  height: optionalPositiveSchema
}).pipe(
  Schema.check(Schema.makeFilter((input) => (input.width == null) === (input.height == null)))
);

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
