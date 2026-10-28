import { answerQuestion } from '#backend/procedures/practice/operations/answer-question';
import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    const result = answerQuestion(ctx.store, input.id, input.answer);

    if (!result) throw new StudyError('not_found', 'Question missing');

    ctx.wake();

    return result.jobId
      ? { type: 'grading' as const, jobId: result.jobId }
      : { type: 'graded' as const, verdict: result.question.verdict! };
  });
