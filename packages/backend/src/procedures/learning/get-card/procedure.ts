import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { cardSnapshot } from '#backend/procedures/learning/cards';
import { publicProcedure } from '#backend/runtime/trpc';

import { inputValidator } from './input.ts';
import { outputValidator } from './output.ts';

export const run = publicProcedure
  .input(inputValidator)
  .output(outputValidator)
  .query(({ ctx, input }) => ({
    snapshot: cardSnapshot(ctx.store, input.versionId, input.cardId),
    schedule:
      ctx.store.db.orm
        .select()
        .from(s.material_card_schedules)
        .where(eq(s.material_card_schedules.card_id, input.cardId))
        .get() ?? null
  }));
