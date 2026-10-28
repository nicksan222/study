import { Schema } from 'effect';

import { llmSettingsSchema } from '#backend/shared/settings/schemas';

export const outputSchema = llmSettingsSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
