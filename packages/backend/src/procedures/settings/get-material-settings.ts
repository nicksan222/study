import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';

import { loadPreferences as dbLoadPreferences } from './preferences.ts';

export const run = publicProcedure.input(z.object({}).default({})).query(({ ctx: context }) => {
  const { store } = context;

  return readMaterialSettings(store);
});

export function readMaterialSettings(ctx: BackendContext) {
  return {
    sift: dbLoadPreferences(ctx, 'material').sift !== false
  };
}
