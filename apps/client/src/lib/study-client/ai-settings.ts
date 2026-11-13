import type { apiKeyInputSchema } from '@study/contracts/settings/schemas';
import type { LlmSettings } from '@study/contracts/settings/types';
import { Effect } from 'effect';

import { signInOptions } from '../host';
import { request } from './request';

export const loadAiSettings = (signal?: AbortSignal) =>
  request(
    (client) =>
      Effect.all(
        {
          status: client['auth.status']({}),
          providers: client['auth.providers']({}),
          settings: client['settings.llmSettings']({})
        },
        { concurrency: 3 }
      ),
    signal
  );

export const startChatGptSignIn = () => {
  try {
    const options = signInOptions();

    return request((client) => client['auth.startSignIn'](options));
  } catch (error) {
    return Promise.reject(error);
  }
};

export const finishChatGptSignIn = (attemptId: string, signal?: AbortSignal) =>
  request((client) => client['auth.finishSignIn']({ attemptId }), signal);

export const cancelChatGptSignIn = (attemptId: string) =>
  request((client) => client['auth.cancelSignIn']({ attemptId }));

export const signOutChatGpt = () => request((client) => client['auth.signOut']({}));

export const saveAiSettings = (settings: LlmSettings) =>
  request((client) => client['settings.saveLlmSettings'](settings));

/** Keys are write-only over RPC; settings queries return only configured status. */
export const saveProviderApiKey = (input: typeof apiKeyInputSchema.Type) =>
  request((client) => client['auth.saveApiKey'](input));
