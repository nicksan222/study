import { Schema } from 'effect';

import { createMaterialInputSchema } from '#server/shared/materials/schemas';

export const inputSchema = createMaterialInputSchema;

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
