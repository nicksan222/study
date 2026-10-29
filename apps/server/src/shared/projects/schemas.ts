import { Schema } from 'effect';

export const projectSchema = Schema.Struct({
  id: Schema.BigInt.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })),
  name: Schema.String,
  examOn: Schema.NullOr(Schema.String),
  createdAt: Schema.BigInt,
  updatedAt: Schema.BigInt
});

export type Project = typeof projectSchema.Type;
