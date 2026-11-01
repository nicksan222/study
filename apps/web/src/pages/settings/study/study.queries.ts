import type { ReviewSettings } from '@study/contracts/settings/types';
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import { loadReviewSettings, saveReviewSettings } from '../../../lib/study-client/preferences';

export const reviewSettingsQueryOptions = () =>
  queryOptions({
    queryKey: ['review-settings'],
    queryFn: ({ signal }) => loadReviewSettings(signal)
  });

export const reviewSettingsMutationOptions = () =>
  mutationOptions({
    mutationFn: (settings: ReviewSettings) => saveReviewSettings(settings)
  });
