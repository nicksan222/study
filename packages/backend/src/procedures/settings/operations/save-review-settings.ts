import { savePreferences } from '#backend/procedures/settings/preferences';
import type { BackendContext } from '#backend/runtime/context';
import { StudyError } from '#backend/shared/errors/index';
import type { ReviewSettings } from '#backend/shared/settings/types';

export function writeReviewSettings(ctx: BackendContext, v: ReviewSettings) {
  if (v.newCardsPerDay > 10000) throw new StudyError('invalid_input', 'invalid review settings');

  savePreferences(ctx, 'review', {
    newCardsPerDay: v.newCardsPerDay
  });
}
