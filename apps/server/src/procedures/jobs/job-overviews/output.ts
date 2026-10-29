import { Schema } from 'effect';

import { jobOverviewSchema } from '#server/shared/jobs/schemas';

export const outputSchema = Schema.Struct({
  items: Schema.mutable(Schema.Array(jobOverviewSchema))
});

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
