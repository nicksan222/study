import { Schema } from 'effect';

const entityIdSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

const naturalSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

const citationMarkerSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 4294967295 })
);

export const memorySchema = Schema.Struct({
  stability: Schema.Number,
  difficulty: Schema.Number,
  reps: naturalSchema,
  lapses: naturalSchema,
  lastReview: Schema.NullOr(Schema.BigInt),
  due: Schema.BigInt,
  state: Schema.Literals([0, 1, 2, 3]),
  elapsedDays: Schema.Number,
  scheduledDays: Schema.Number,
  learningSteps: naturalSchema
});

export const cardSchema = Schema.Struct({
  id: entityIdSchema,
  artifactId: entityIdSchema,
  materialCardId: Schema.optional(entityIdSchema),
  ordinal: Schema.BigInt,
  front: Schema.String,
  back: Schema.String,
  cites: Schema.mutable(Schema.Array(citationMarkerSchema)),
  memory: memorySchema
});
