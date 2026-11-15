import type { ModelTier } from '@study/contracts/settings/schemas';

import { useAiConfiguration } from '#client/lib/study-client/ai-settings.queries.ts';
import type { AiConfiguration } from '#client/lib/study-client/ai-settings.ts';

type AiSettings = AiConfiguration;

export function aiReadiness(data: AiSettings, tier: ModelTier): boolean {
  const setup = data.settings[tier];

  if (setup.provider === 1) return data.status.signedIn && data.status.sharing;

  return data.providers.some((provider) => provider.id === setup.provider && provider.configured);
}

export type AiReadiness = 'checking' | 'unavailable' | 'setup' | 'ready';

export function useAiReadiness(tier: ModelTier): AiReadiness {
  const query = useAiConfiguration();

  if (query.isPending) return 'checking' as const;

  if (query.isError || query.stale || !query.data) return 'unavailable' as const;

  return aiReadiness(query.data, tier) ? ('ready' as const) : ('setup' as const);
}
