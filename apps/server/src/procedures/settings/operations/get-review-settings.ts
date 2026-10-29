import { loadPreferences } from '#server/procedures/settings/preferences';
import type { ServerContext } from '#server/runtime/context';

export function readReviewSettings(ctx: ServerContext) {
  const v = loadPreferences(ctx, 'review');

  return {
    newCardsPerDay: typeof v.newCardsPerDay === 'number' ? v.newCardsPerDay : 20
  };
}
