import { artifactView } from '#backend/procedures/material/operations/artifact';
import { listArtifacts } from '#backend/procedures/material/operations/material';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => {
    const all = listArtifacts(ctx.store, input.id);
    const grouped = new Map<string, typeof all>();

    for (const artifact of all) {
      const key = artifact.mistakes ? `mistakes:${artifact.id}` : artifact.kind;

      grouped.set(key, [...(grouped.get(key) ?? []), artifact]);
    }

    return {
      items: [...grouped.values()].map((items) => {
        const current = items.find((artifact) => artifact.status === 'complete');
        const update = items.find((artifact) => artifact.status !== 'complete');

        return {
          current: current ? artifactView(ctx.store, current) : undefined,
          update: update ? artifactView(ctx.store, update) : null
        };
      })
    };
  });
