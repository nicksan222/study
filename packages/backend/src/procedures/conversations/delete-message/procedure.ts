import { deleteMessage } from '#backend/procedures/conversations/operations/delete-message';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({ value: deleteMessage(ctx.store, input.id) }));
