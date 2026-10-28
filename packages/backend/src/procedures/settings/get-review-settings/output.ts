import { Schema } from 'effect';

import { reviewSettingsSchema } from '#backend/shared/settings/schemas';

export const outputSchema = reviewSettingsSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
