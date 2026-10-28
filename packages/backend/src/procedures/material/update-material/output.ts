import { Schema } from 'effect';

import { materialEntityIdSchema } from '#backend/shared/material/schemas';

export const outputSchema = Schema.Struct({ id: materialEntityIdSchema });

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
