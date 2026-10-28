import { now, artifact as getArtifact } from '#backend/procedures/material/operations/artifact';
import { dueCards } from '#backend/procedures/practice/operations/due-cards';
import { newCardAllowance } from '#backend/procedures/practice/operations/due-count';
import { publicProcedure } from '#backend/runtime/trpc';

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
