import type { ModelTier, TierSetup } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useState } from 'react';

import type { AiConfiguration } from '#client/lib/study-client/ai-settings.ts';

/** Keep provider edits local; committed settings arrive through the live protocol. */
export function useProviderSettings(data: AiConfiguration | undefined) {
  const [credentialProvider, selectCredentialProvider] = useState('1');
  const save = rpc.settings.saveModelTier.useMutation();
  const saveKey = rpc.auth.saveApiKey.useMutation();
  const [keyError, setKeyError] = useState(false);

  function setSetup(tier: ModelTier, setup: TierSetup) {
    if (data) void save.mutateAsync({ tier, setup }).catch(() => {});
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
    saveApiKey: async (provider: string, apiKey: string | null) => {
      try {
        await saveKey.mutateAsync({ provider, apiKey });
        setKeyError(false);
      } catch (error) {
        setKeyError(true);

        throw error;
      } finally {
        saveKey.reset();
      }
    }
  };
}
