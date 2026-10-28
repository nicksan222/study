import { Schema } from 'effect';

import { themeFileSchema } from '#backend/shared/themes/schemas';

export const outputSchema = themeFileSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
