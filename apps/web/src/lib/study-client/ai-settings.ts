import { StudyError } from '@study/contracts/errors';
import type { apiKeyInputSchema } from '@study/contracts/settings/schemas';
import type { LlmSettings } from '@study/contracts/settings/types';
import { isTauri } from '@tauri-apps/api/core';
import { Effect } from 'effect';

import { browserOrigin } from './client';
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

/** Use the browser's reachable forwarded port, independent of the server's private listener. */
export function browserSignInCallbackUrl(origin: string): string {
  const url = new URL(origin);

  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new StudyError(
      'unsupported',
      'ChatGPT sign-in requires Study on an HTTP loopback origin'
    );

  url.hostname = '127.0.0.1';

  return new URL('/auth/callback', url).href;
}

export const startChatGptSignIn = () => {
  if (isTauri()) return request((client) => client['auth.startSignIn']({}));

  try {
    const callbackUrl = browserSignInCallbackUrl(browserOrigin());

    return request((client) => client['auth.startSignIn']({ callbackUrl }));
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
