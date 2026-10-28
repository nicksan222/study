import { loadPreferences } from '#backend/procedures/settings/preferences';
import type { BackendContext } from '#backend/runtime/context';

export function readReviewSettings(ctx: BackendContext) {
  const v = loadPreferences(ctx, 'review');

  return {
    newCardsPerDay: typeof v.newCardsPerDay === 'number' ? v.newCardsPerDay : 20
  };
}
