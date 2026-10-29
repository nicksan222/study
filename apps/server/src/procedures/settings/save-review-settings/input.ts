import { Schema } from 'effect';

import { reviewSettingsSchema } from '#server/shared/settings/schemas';

export const inputSchema = reviewSettingsSchema;

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
