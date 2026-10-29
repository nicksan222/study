import { answerQuestion } from '#server/procedures/practice/operations/answer-question';
import { publicProcedure } from '#server/runtime/trpc';
import { StudyError } from '#server/shared/errors/index';

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
