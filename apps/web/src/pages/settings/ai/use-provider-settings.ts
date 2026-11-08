import type { ModelTier } from '@study/contracts/settings/schemas';
import type { TierSetup } from '@study/contracts/settings/types';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import type { loadAiSettings } from '#web/lib/study-client/ai-settings.ts';

import { saveModelsOptions, saveApiKeyOptions } from './ai.queries';

/** Model selection and write-only credential mutations share invalidation, not sign-in state. */
export function useProviderSettings(
  data: Awaited<ReturnType<typeof loadAiSettings>> | undefined,
  refresh: () => Promise<void>
) {
  const [credentialProvider, selectCredentialProvider] = useState('1');
  const save = useMutation({ ...saveModelsOptions(), onSuccess: refresh });
  const [keyError, setKeyError] = useState(false);
  const saveKey = useMutation({
    ...saveApiKeyOptions(),
    onSuccess: refresh,
    onSettled: (_data, error) => {
      setKeyError(!!error);
      saveKey.reset();
    }
  });

  function setSetup(tier: ModelTier, setup: TierSetup) {
    if (data) save.mutate({ ...data.settings, [tier]: setup });
  }

  return {
    credentialProvider,
    selectCredentialProvider,
    pending: save.isPending || saveKey.isPending,
    error: save.isError || keyError,
    retry: () => {
      save.reset();
      setKeyError(false);
    },
    setSetup,
    saveApiKey: (provider: string, apiKey: string | null) =>
      saveKey.mutateAsync({ provider, apiKey })
  };
}
