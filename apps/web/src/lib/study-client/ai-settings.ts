import type { LlmSettings } from '@study/contracts/settings/types';
import { Effect } from 'effect';

import { request } from './request';

export const loadAiSettings = (signal?: AbortSignal) =>
  request(
    (client) =>
      Effect.all(
        {
          status: client['auth.status']({}),
          settings: client['settings.llmSettings']({})
        },
        { concurrency: 2 }
      ),
    signal
  );

export const startChatGptSignIn = () => request((client) => client['auth.startSignIn']({}));

export const finishChatGptSignIn = (attemptId: string, signal?: AbortSignal) =>
  request((client) => client['auth.finishSignIn']({ attemptId }), signal);

export const cancelChatGptSignIn = (attemptId: string) =>
  request((client) => client['auth.cancelSignIn']({ attemptId }));

export const signOutChatGpt = () => request((client) => client['auth.signOut']({}));

export const saveAiSettings = (settings: LlmSettings) =>
  request((client) => client['settings.saveLlmSettings'](settings));
