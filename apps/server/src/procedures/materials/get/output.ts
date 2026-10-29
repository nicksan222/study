import { Schema } from 'effect';

import { materialDetailSchema } from '#server/shared/materials/schemas';

export const outputSchema = Schema.NullOr(materialDetailSchema);

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
