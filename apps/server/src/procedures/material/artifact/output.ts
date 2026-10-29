import { Schema } from 'effect';

import { artifactViewSchema } from '#server/shared/material/schemas';

export const outputSchema = Schema.Struct({ value: Schema.NullOr(artifactViewSchema) });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
