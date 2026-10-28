import { Schema } from 'effect';

import { ingestedMaterialSchema } from '#backend/shared/ingestion/schemas';

export const outputSchema = ingestedMaterialSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
