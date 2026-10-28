import { Schema } from 'effect';

import { materialCitationSchema } from '#backend/shared/materials/schemas';

export const outputSchema = Schema.mutable(Schema.Array(materialCitationSchema));

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
