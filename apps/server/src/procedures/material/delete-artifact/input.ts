import { Schema } from 'effect';

import { materialEntityIdSchema } from '#server/shared/material/schemas';

export const inputSchema = Schema.Struct({ id: materialEntityIdSchema });

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
