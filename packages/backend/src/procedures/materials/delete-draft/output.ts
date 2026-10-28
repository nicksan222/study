import { Schema } from 'effect';

import { materialIdSchema } from '#backend/shared/materials/schemas';

export const outputSchema = Schema.Struct({ id: materialIdSchema });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
