import { Schema } from 'effect';

import { quizAttemptSchema } from '#backend/shared/learning/schemas';

export const outputSchema = quizAttemptSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
