import { Schema } from 'effect';

import { materialChangesSchema } from '#backend/shared/material/schemas';

export const outputSchema = Schema.Struct({ value: Schema.NullOr(materialChangesSchema) });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
