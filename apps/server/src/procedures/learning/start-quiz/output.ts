import { Schema } from 'effect';

import { quizAttemptInProgressSchema } from '#server/shared/learning/schemas';

export const outputSchema = quizAttemptInProgressSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
