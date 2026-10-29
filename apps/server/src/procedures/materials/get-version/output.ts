import { Schema } from 'effect';

import { materialVersionDetailSchema } from '#server/shared/materials/schemas';

export const outputSchema = Schema.NullOr(materialVersionDetailSchema);

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
