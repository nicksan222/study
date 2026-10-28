import { Schema } from 'effect';

import { publicAccountSchema } from '#backend/shared/auth/schemas';

export const outputSchema = publicAccountSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
