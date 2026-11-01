import type { Language, ReviewSettings } from '@study/contracts/settings/types';
import { Effect } from 'effect';

import { request } from './request';

export const loadAppSettings = (signal?: AbortSignal) =>
  request((client) => client['settings.appSettings']({}), signal);

export const saveLanguage = (language: Language) =>
  request((client) =>
    Effect.gen(function* () {
      // Read immediately before writing so another settings section keeps its values.
      const settings = yield* client['settings.appSettings']({});
      const updated = { ...settings, language };

      yield* client['settings.saveAppSettings'](updated);

      return updated;
    })
  );

export const loadReviewSettings = (signal?: AbortSignal) =>
  request((client) => client['settings.reviewSettings']({}), signal);

export const saveReviewSettings = (settings: ReviewSettings) =>
  request((client) => client['settings.saveReviewSettings'](settings));
