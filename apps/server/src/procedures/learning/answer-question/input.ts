import { Schema } from 'effect';

import { learningIdSchema, quizAnswerSchema } from '#server/shared/learning/schemas';

export const inputSchema = Schema.Struct({
  attemptId: learningIdSchema,
  questionId: learningIdSchema,
  answer: quizAnswerSchema
});

export type Input = typeof inputSchema.Type;

export const inputValidator = Schema.toStandardSchemaV1(inputSchema);
