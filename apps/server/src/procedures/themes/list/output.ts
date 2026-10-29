import { Schema } from 'effect';

import { themeFileSchema } from '#server/shared/themes/schemas';

export const outputSchema = Schema.Array(themeFileSchema);

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
