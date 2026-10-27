import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';
import { StudyError } from '#backend/shared/errors/index';
import type { ReviewSettings } from '#backend/shared/settings/types';

import { savePreferences as dbSavePreferences } from './preferences.ts';

export const run = publicProcedure
  .input(
    z.object({
      newCardsPerDay: z.number().int().min(0).max(10000)
    })
  )
  .mutation(({ ctx: context, input: r }) => {
    const { store } = context;

    writeReviewSettings(store, r);

    return {};
  });

export function writeReviewSettings(ctx: BackendContext, v: ReviewSettings) {
  if (v.newCardsPerDay > 10000) throw new StudyError('invalid_input', 'invalid review settings');

  dbSavePreferences(ctx, 'review', {
    newCardsPerDay: v.newCardsPerDay
  });
}
