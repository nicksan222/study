import { cards } from '#backend/procedures/material/operations/artifact';
import { deleteCard, updateCard } from '#backend/procedures/material/operations/set-card';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => {
    const card = cards(ctx.store, input.artifact)[input.index];

    if (!card) return { value: false };

    return {
      value:
        input.change.type === 'write'
          ? updateCard(ctx.store, card.id, input.change.front, input.change.back)
          : deleteCard(ctx.store, card.id)
    };
  });
