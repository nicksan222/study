import { setExam } from '#backend/procedures/projects/operations/set-exam';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({ value: setExam(ctx.store, input.id, input.examOn) }));
