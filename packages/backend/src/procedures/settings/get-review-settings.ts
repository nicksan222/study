import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';

import { loadPreferences as dbLoadPreferences } from './preferences.ts';

export const run = publicProcedure.input(z.object({}).default({})).query(({ ctx: context }) => {
  const { store } = context;

  return readReviewSettings(store);
});

export function readReviewSettings(ctx: BackendContext) {
  const v = dbLoadPreferences(ctx, 'review');

  return {
    newCardsPerDay: typeof v.newCardsPerDay === 'number' ? v.newCardsPerDay : 20
  };
}
