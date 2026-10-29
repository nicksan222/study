import { Schema } from 'effect';

import { projectSchema } from '#server/shared/projects/schemas';

export const outputSchema = Schema.Struct({ items: Schema.mutable(Schema.Array(projectSchema)) });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
