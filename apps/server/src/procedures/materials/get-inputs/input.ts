import { Schema } from 'effect';

import { materialIdSchema, materialPageSchema } from '#server/shared/materials/schemas';

export const inputSchema = Schema.Struct({ ...materialPageSchema.fields, id: materialIdSchema });

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
