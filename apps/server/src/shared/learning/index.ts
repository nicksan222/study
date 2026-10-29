import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';

import type { learningRouter } from '#server/procedures/learning/router';

export type { CardSnapshot, QuizAttempt } from './schemas.ts';

export type LearningInputs = inferRouterInputs<typeof learningRouter>;

export type LearningOutputs = inferRouterOutputs<typeof learningRouter>;
