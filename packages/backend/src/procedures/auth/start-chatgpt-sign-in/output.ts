import { Schema } from 'effect';

import { signInAttemptSchema } from '#backend/shared/auth/schemas';

export const outputSchema = signInAttemptSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
