import { editMessage } from '#server/procedures/conversations/operations/edit-message';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({ value: editMessage(ctx.store, input.id, input.text) }));
