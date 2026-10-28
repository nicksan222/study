import { importFile } from '#backend/procedures/sources/operations/import-file';
import { backendError } from '#backend/runtime/errors';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .mutation(({ ctx, input }) => ({
    items: input.paths.map((path) => {
      try {
        const source = importFile(ctx.store, path, input.project ?? null);

        ctx.wake();

        return { path, type: 'source' as const, source };
      } catch (error) {
        const failure = backendError(error, ctx.language());

        return {
          path,
          type: 'error' as const,
          error: { kind: failure.kind, message: failure.message }
        };
      }
    })
  }));
