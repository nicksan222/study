/** @file Owns api keys within this feature. */

import { StudyError, apiKeyInputSchema } from '@study/contracts';
import { Effect, Schema } from 'effect';

import { ApiKeyStore } from '#server/features/auth/store/index';
import { getApiKeyProvider, providerCatalog } from '#server/platform/ai/providers/registry';
import { transaction, useStore } from '#server/platform/definitions/define-store';

import { authFailure, invalid } from './errors.ts';

export function* authApiKeyOperations() {
  const keysStore = yield* useStore(ApiKeyStore);

  return {
    providers: () =>
      keysStore
        .apiKeys(undefined)
        .pipe(
          Effect.map((keys) =>
            providerCatalog().map((provider) => ({ ...provider, configured: !!keys[provider.id] }))
          )
        ),
    apiKey: Effect.fnUntraced(function* (provider: string) {
      yield* Effect.try({ try: () => getApiKeyProvider(provider), catch: authFailure });
      const keys = yield* keysStore.apiKeys(undefined);
      const key = keys[provider];

      return key
        ? key
        : yield* Effect.fail(new StudyError('auth', 'AI provider API key is missing'));
    }),
    saveApiKey: Effect.fnUntraced(function* (input: typeof apiKeyInputSchema.Type) {
      if (!Schema.is(apiKeyInputSchema)(input))
        return yield* Effect.fail(invalid('Invalid API key'));

      yield* Effect.try({ try: () => getApiKeyProvider(input.provider), catch: authFailure });
      yield* transaction((tx) => tx.store(ApiKeyStore).saveApiKey(input));
    })
  };
}
