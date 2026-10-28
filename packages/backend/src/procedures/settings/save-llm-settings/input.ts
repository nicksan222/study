import { Schema } from 'effect';

import { llmSettingsSchema } from '#backend/shared/settings/schemas';

export const inputSchema = llmSettingsSchema;

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
