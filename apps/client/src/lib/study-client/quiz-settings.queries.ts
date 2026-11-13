import type { QuizSettings } from '@study/contracts/settings/types';
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import { request } from '#client/lib/study-client/request.ts';

export const quizSettingsOptions = () =>
  queryOptions({
    queryKey: ['quiz-settings'],
    queryFn: ({ signal }) => request((client) => client['settings.quizSettings']({}), signal)
  });

export const quizSettingsMutationOptions = () =>
  mutationOptions({
    mutationFn: (settings: QuizSettings) =>
      request((client) => client['settings.saveQuizSettings'](settings))
  });
