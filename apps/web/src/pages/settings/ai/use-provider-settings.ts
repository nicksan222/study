import type { ModelTier } from '@study/contracts/settings/schemas';
import type { LlmModel, TierSetup } from '@study/contracts/settings/types';
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

  function setModel(tier: ModelTier, model: LlmModel | string | undefined) {
    const setup = data?.settings[tier];

    if (!setup) return;

    if (typeof setup.provider === 'string' && typeof model !== 'number')
      setSetup(tier, { provider: setup.provider, model });
    else if (setup.provider === 1 && typeof model !== 'string')
      setSetup(tier, { provider: 1, model });
  }

  function setProvider(tier: ModelTier, provider: TierSetup['provider']) {
    if (provider === 1 || data?.providers.some((entry) => entry.id === provider))
      setSetup(tier, provider === 1 ? { provider: 1 } : { provider });
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
    setModel,
    setProvider,
    saveApiKey: (provider: string, apiKey: string | null) =>
      saveKey.mutateAsync({ provider, apiKey })
  };
}
