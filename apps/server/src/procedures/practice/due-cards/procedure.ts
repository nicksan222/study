import { now, artifact as getArtifact } from '#server/procedures/material/operations/artifact';
import { dueCards } from '#server/procedures/practice/operations/due-cards';
import { newCardAllowance } from '#server/procedures/practice/operations/due-count';
import { publicProcedure } from '#server/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    const cards = dueCards(
      ctx.store,
      input.project ?? null,
      now(),
      input.limit || 100,
      newCardAllowance(ctx.store)
    );

    return {
      items: cards.flatMap((card) => {
        const value = getArtifact(ctx.store, card.artifactId);

        return value
          ? [{ card, artifactTitle: value.title, projectId: value.projectId ?? null }]
          : [];
      })
    };
  });
