import { z } from 'zod';

import { backendError } from '#backend/runtime/errors';
import { publicProcedure, idInput } from '#backend/runtime/trpc';

import { importFile } from './import-file.ts';

export const run = publicProcedure
  .input(
    z.object({
      paths: z.array(z.string()).max(100),
      project: idInput.nullish()
    })
  )
  .mutation(({ ctx, input }) => {
    const project = input.project ?? null;

    return {
      items: input.paths.map((path) => {
        try {
          const source = importFile(ctx.store, path, project);

          ctx.wake();

          return {
            path,
            type: 'source' as const,
            source
          };
        } catch (error) {
          const failure = backendError(error, ctx.language());

          return {
            path,
            type: 'error' as const,
            error: {
              kind: failure.kind,
              message: failure.message
            }
          };
        }
      })
    };
  });
