import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';

import { savePreferences as dbSavePreferences } from './preferences.ts';

export const run = publicProcedure
  .input(
    z.object({
      sift: z.boolean().default(false)
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    writeMaterialSettings(store, r.sift);

    return {};
  });

export function writeMaterialSettings(ctx: BackendContext, sift: boolean) {
  dbSavePreferences(ctx, 'material', {
    sift
  });
}
