import { targetJobs } from '#backend/procedures/jobs/operations/job-overviews';
import {
  ensurePracticeQuestions,
  practiceScore
} from '#backend/procedures/practice/operations/practice';
import { listPractices } from '#backend/procedures/practice/operations/practices';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    const p = listPractices(ctx.store).find((practice) => practice.id === input.id);

    if (!p) return { value: null };

    const questions = ensurePracticeQuestions(ctx.store, input.id);

    ctx.wake();

    return {
      value: {
        id: p.id,
        projectId: p.projectId,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        score: practiceScore(ctx.store, input.id),
        questions: questions.map((question) => ({
          ...question,
          job: targetJobs(ctx.store, 'question', question.id)[0] ?? null
        }))
      }
    };
  });
