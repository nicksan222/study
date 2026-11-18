import { LlmProvider } from '@study/contracts';
import type { ModelTier } from '@study/contracts';

import { useAiConfiguration } from '#client/lib/study-client/ai-settings.queries.ts';
import type { AiConfiguration } from '#client/lib/study-client/ai-settings.ts';

type AiSettings = AiConfiguration;

export type AiReadinessProvider = 'chatgpt' | 'configured-or-chatgpt';

export function aiReadiness(
  data: AiSettings,
  tier: ModelTier,
  provider?: AiReadinessProvider
): boolean {
  const setup = data.settings[tier];
  const signedIn = data.status.signedIn && data.status.sharing;

  if (provider === 'chatgpt' || setup.provider === LlmProvider.CHAT_GPT) return signedIn;

  if (provider === 'configured-or-chatgpt' && signedIn) return true;

  return data.providers.some((provider) => provider.id === setup.provider && provider.configured);
}

export type AiReadiness = 'checking' | 'unavailable' | 'setup' | 'ready';

export function useAiReadiness(tier: ModelTier, provider?: AiReadinessProvider): AiReadiness {
  const query = useAiConfiguration();

  if (query.isPending) return 'checking' as const;

  if (query.isError || query.stale || !query.data) return 'unavailable' as const;

  return aiReadiness(query.data, tier, provider) ? ('ready' as const) : ('setup' as const);
}
