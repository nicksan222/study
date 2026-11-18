/** @file Composes settings application operations behind the feature boundary. */

import type { UsageQuery } from '@study/contracts';
import { ChatGptSession, defineService, useStore, UsageStore } from '@study/server';
import { Effect, Option, Semaphore } from 'effect';

import { makeModelCatalogRefresh } from './model-catalog.ts';
import { modelUpdateOperations } from './model-updates.ts';
import { settingsModelOperations } from './models.ts';
import { settingsPreferenceOperations } from './preferences.ts';

const make = function* () {
  const usage = yield* useStore(UsageStore);
  const session = Option.getOrUndefined(yield* Effect.serviceOption(ChatGptSession));
  const account = () => session?.manager.catalogAccount();
  const models = yield* settingsModelOperations(account);
  const { catalogIdentities, ...updates } = yield* modelUpdateOperations(account);
  const refresh = makeModelCatalogRefresh(
    models.llmSettings,
    catalogIdentities,
    updates.refreshModelCatalog
  );
  const catalogLock = yield* Semaphore.make(1);

  return {
    usage: (query: UsageQuery) => usage.usageReport(query),
    ...models,
    ...updates,
    refreshModelRecommendations: (session: Parameters<typeof refresh>[0]) =>
      catalogLock.withPermit(refresh(session)),
    ...(yield* settingsPreferenceOperations())
  };
};

export const Settings = defineService('study/Settings', make);
