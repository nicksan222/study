import { Schema } from 'effect';

import { quizAttemptCompletedSchema } from '#server/shared/learning/schemas';

export const outputSchema = quizAttemptCompletedSchema;

export type Output = typeof outputSchema.Type;

export const outputValidator = Schema.toStandardSchemaV1(outputSchema);
