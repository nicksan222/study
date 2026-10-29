import { addMistakeCard } from '#server/procedures/practice/operations/add-to-flashcards';
import { question } from '#server/procedures/practice/operations/practice';
import { publicProcedure } from '#server/runtime/trpc';
import { StudyError } from '#server/shared/errors/index';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    const q = question(ctx.store, input.question);

    if (!q?.body) throw new StudyError('not_found', 'Question missing');

    const back = q.body.type === 'choice' ? q.body.choices[q.body.answer] : q.body.reference;

    addMistakeCard(ctx.store, input.question, q.body.question, back, input.title);

    return { value: true };
  });
