/** Provider adapters normalize transfers; the server owns execution, identity and publication. */
import { StudyError } from '@study/contracts/errors';

import type { IntegrationProvider } from './capabilities.ts';
import { obsidianProvider } from './providers/obsidian/index.ts';

export type { IntegrationProvider } from './capabilities.ts';

const providers: readonly IntegrationProvider[] = [obsidianProvider];

export function integrationProvider(id: string): IntegrationProvider {
  const provider = providers.find((entry) => entry.id === id);

  if (!provider) throw new StudyError('unsupported', 'Integration provider is unavailable');

  return provider;
}

export function integrationProviders() {
  return providers.map((provider) => ({
    id: provider.id,
    capabilities: Object.keys(provider.capabilities) as ('import' | 'export')[]
  }));
}
