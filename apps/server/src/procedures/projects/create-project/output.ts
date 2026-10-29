import { Schema } from 'effect';

import { projectSchema } from '#server/shared/projects/schemas';

export const outputSchema = projectSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
