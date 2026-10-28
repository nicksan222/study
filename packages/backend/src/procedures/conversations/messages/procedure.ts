import { listMessages, messageView } from '#backend/procedures/conversations/operations/messages';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => ({
    items: listMessages(ctx.store, input.id).map((message) => messageView(ctx.store, message))
  }));
