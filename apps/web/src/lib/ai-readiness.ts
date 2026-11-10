import type { ModelTier } from '@study/contracts/settings/schemas';
import { useQuery } from '@tanstack/react-query';

import { aiSettingsQueryOptions } from '#web/lib/study-client/ai-settings.queries.ts';
import type { loadAiSettings } from '#web/lib/study-client/ai-settings.ts';

type AiSettings = Awaited<ReturnType<typeof loadAiSettings>>;

export function aiReadiness(data: AiSettings, tier: ModelTier): boolean {
  const setup = data.settings[tier];

  if (setup.provider === 1) return data.status.signedIn && data.status.sharing;

  return data.providers.some((provider) => provider.id === setup.provider && provider.configured);
}

export type AiReadiness = 'checking' | 'unavailable' | 'setup' | 'ready';

export function useAiReadiness(tier: ModelTier): AiReadiness {
  const query = useQuery(aiSettingsQueryOptions());

  if (query.isPending) return 'checking' as const;

  if (query.isError || !query.data) return 'unavailable' as const;

  return aiReadiness(query.data, tier) ? ('ready' as const) : ('setup' as const);
}
