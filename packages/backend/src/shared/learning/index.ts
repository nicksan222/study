import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';

import type { learningRouter } from '#backend/procedures/learning/router';

export type { QuizAttempt } from '#backend/procedures/learning/quiz';
export type { CardSnapshot } from '#backend/procedures/learning/cards';

export type LearningInputs = inferRouterInputs<typeof learningRouter>;

export type LearningOutputs = inferRouterOutputs<typeof learningRouter>;
