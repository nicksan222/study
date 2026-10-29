import { Schema } from 'effect';

import { appSettingsSchema } from '#server/shared/settings/schemas';

export const inputSchema = appSettingsSchema;

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
