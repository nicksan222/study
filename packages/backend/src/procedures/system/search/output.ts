import { Schema } from 'effect';

import { searchResultSchema } from '#backend/shared/system/schemas';

export const outputSchema = searchResultSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
