import { savePreferences } from '#server/procedures/settings/preferences';
import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';
import type { ReviewSettings } from '#server/shared/settings/types';

export function writeReviewSettings(ctx: ServerContext, v: ReviewSettings) {
  if (v.newCardsPerDay > 10000) throw new StudyError('invalid_input', 'invalid review settings');

  savePreferences(ctx, 'review', {
    newCardsPerDay: v.newCardsPerDay
  });
}
