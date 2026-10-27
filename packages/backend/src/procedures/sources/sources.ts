import * as schema from '@study/db/schema';
import { desc } from 'drizzle-orm';
import { z } from 'zod';

import type { BackendContext } from '#backend/runtime/context';
import { publicProcedure } from '#backend/runtime/trpc';
import type { Source } from '#backend/shared/sources/types';

import { sourceRow, selectSources as dbSelectSources } from './source.ts';

export const run = publicProcedure.input(z.object({}).default({})).query(({ ctx: context }) => {
  const { store } = context;

  return {
    items: listSources(store)
  };
});

export function listSources(ctx: BackendContext): Source[] {
  return dbSelectSources(ctx).orderBy(desc(schema.sources.id)).all().map(sourceRow);
}
