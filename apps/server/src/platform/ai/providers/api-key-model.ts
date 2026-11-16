/** @file Resolves credentials at the HTTP boundary for every provider request. */
import type { StudyError } from '@study/contracts';
import type { Effect } from 'effect';

import type { ApiKeyProvider } from './definition.ts';

export function createApiKeyModel(
  provider: ApiKeyProvider,
  modelId: string,
  apiKey: Effect.Effect<string, StudyError>,
  fetch?: (...args: Parameters<typeof globalThis.fetch>) => ReturnType<typeof globalThis.fetch>
) {
  return provider.createModel({ apiKey: 'unconfigured', resolveApiKey: apiKey, modelId, fetch });
}
