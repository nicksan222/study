import type { LlmSettings } from '@study/contracts/settings/types';
import { mutationOptions, queryOptions } from '@tanstack/react-query';

import {
  loadAiSettings,
  startChatGptSignIn,
  finishChatGptSignIn,
  cancelChatGptSignIn,
  signOutChatGpt,
  saveAiSettings
} from '#web/lib/study-client/ai-settings.ts';

export type SignInAttempt = Awaited<ReturnType<typeof startChatGptSignIn>>;

export function aiSettingsQueryOptions() {
  return queryOptions({
    queryKey: ['ai-settings'],
    queryFn: ({ signal }) => loadAiSettings(signal)
  });
}

export const startSignInOptions = () => mutationOptions({ mutationFn: startChatGptSignIn });

export const finishSignInOptions = () =>
  mutationOptions({
    mutationFn: ({ attemptId, signal }: { attemptId: string; signal: AbortSignal }) =>
      finishChatGptSignIn(attemptId, signal)
  });

export const cancelSignInOptions = () =>
  mutationOptions({ mutationFn: (attemptId: string) => cancelChatGptSignIn(attemptId) });

export const signOutOptions = () => mutationOptions({ mutationFn: signOutChatGpt });

export const saveModelsOptions = () =>
  mutationOptions({ mutationFn: (settings: LlmSettings) => saveAiSettings(settings) });

// This owns only the attempt started by this mounted settings section.
export const disposeSignIn = (attemptId: string) => cancelChatGptSignIn(attemptId);
