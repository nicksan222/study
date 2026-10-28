import { Schema } from 'effect';

import { sessionSchema } from '#backend/shared/conversations/schemas';

export const outputSchema = sessionSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
