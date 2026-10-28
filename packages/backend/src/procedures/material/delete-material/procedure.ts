import { deleteArtifact } from '#backend/procedures/material/operations/delete-artifact';
import { listArtifacts } from '#backend/procedures/material/operations/material';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({
    value: ctx.store.transaction(() =>
      listArtifacts(ctx.store, input.project)
        .filter((artifact) => artifact.kind === input.kind && !artifact.mistakes)
        .reduce((changed, artifact) => deleteArtifact(ctx.store, artifact.id) || changed, false)
    )
  }));
