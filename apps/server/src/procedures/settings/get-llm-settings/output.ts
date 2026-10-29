import { Schema } from 'effect';

import { llmSettingsSchema } from '#server/shared/settings/schemas';

export const outputSchema = llmSettingsSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
