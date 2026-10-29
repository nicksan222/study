import { Schema } from 'effect';

import { jobSchema } from '#server/shared/jobs/schemas';

export const outputSchema = Schema.Struct({ value: Schema.NullOr(jobSchema) });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
