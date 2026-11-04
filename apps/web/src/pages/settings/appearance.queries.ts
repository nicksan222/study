import type { AppearancePreferences } from '@study/contracts/settings/types';
import { Appearance } from '@study/contracts/settings/types';
import type { Appearance as AppearanceMode } from '@study/ui/theme';
import { queryOptions, mutationOptions } from '@tanstack/react-query';

import {
  loadAppearance,
  updateAppSettings,
  saveAppearancePreferences,
  selectTheme,
  importTheme,
  saveTheme,
  deleteTheme
} from '#web/lib/study-client/operations.ts';

export type AppearanceData = Awaited<ReturnType<typeof loadAppearance>>;

type Change =
  | { type: 'appearance'; mode: AppearanceMode }
  | { type: 'select'; id: string }
  | { type: 'import' | 'save'; json: string }
  | { type: 'delete'; id: string }
  | { type: 'preferences'; preferences: AppearancePreferences }
  | { type: 'zoom'; percent: number };

export function appearanceQueryOptions() {
  return queryOptions({
    queryKey: ['appearance'],
    queryFn: ({ signal }) => loadAppearance(signal)
  });
}

export function appearanceMutationOptions() {
  return mutationOptions({
    mutationFn: async (change: Change) => {
      switch (change.type) {
        case 'appearance': {
          const appearance =
            change.mode === 'system'
              ? Appearance.SYSTEM
              : change.mode === 'light'
                ? Appearance.LIGHT
                : Appearance.DARK;

          return updateAppSettings({ appearance });
        }
        case 'preferences':
          return saveAppearancePreferences(change.preferences);
        case 'zoom':
          return updateAppSettings({ zoomPercent: change.percent });
        case 'select':
          return selectTheme(change.id);
        case 'import':
          return importTheme(change.json);
        case 'save':
          return saveTheme(change.json);
        case 'delete':
          return deleteTheme(change.id);
      }
    }
  });
}
