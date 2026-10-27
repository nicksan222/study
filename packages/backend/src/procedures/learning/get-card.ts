import * as s from '@study/db/schema';
import { eq } from 'drizzle-orm';

import { publicProcedure } from '#backend/runtime/trpc';

import { cardSnapshot } from './cards.ts';
import { cardInput } from './inputs.ts';

export const run = publicProcedure.input(cardInput).query(({ ctx, input }) => ({
  snapshot: cardSnapshot(ctx.store, input.versionId, input.cardId),
  schedule:
    ctx.store.db.orm
      .select()
      .from(s.material_card_schedules)
      .where(eq(s.material_card_schedules.card_id, input.cardId))
      .get() ?? null
}));
