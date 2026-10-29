import { Schema } from 'effect';

import { materialVersionDetailSchema } from '#server/shared/materials/schemas';

export const outputSchema = materialVersionDetailSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
