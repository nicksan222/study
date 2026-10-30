import { Schema } from 'effect';

import { projectIdSchema } from '../ids.ts';

export const projectSchema = Schema.Struct({
  id: projectIdSchema.check(Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })),
  name: Schema.String,
  examOn: Schema.NullOr(Schema.String),
  createdAt: Schema.BigInt,
  updatedAt: Schema.BigInt
});

export type Project = typeof projectSchema.Type;
