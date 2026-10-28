import { Schema } from 'effect';

import { appSettingsSchema } from '#backend/shared/settings/schemas';

export const outputSchema = appSettingsSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
