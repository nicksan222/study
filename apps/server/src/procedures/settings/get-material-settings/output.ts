import { Schema } from 'effect';

import { materialSettingsSchema } from '#server/shared/settings/schemas';

export const outputSchema = materialSettingsSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
