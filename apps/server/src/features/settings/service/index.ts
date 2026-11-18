/** @file Composes settings application operations behind the feature boundary. */

import type { UsageQuery } from '@study/contracts';
import { defineService, useStore, UsageStore } from '@study/server';
import { Semaphore } from 'effect';

import { makeModelCatalogRefresh } from './model-catalog.ts';
import { modelUpdateOperations } from './model-updates.ts';
import { settingsModelOperations } from './models.ts';
import { settingsPreferenceOperations } from './preferences.ts';

const make = function* () {
  const usage = yield* useStore(UsageStore);
  const models = yield* settingsModelOperations();
  const updates = yield* modelUpdateOperations();
  const refresh = makeModelCatalogRefresh(models.llmSettings, updates.refreshModelCatalog);
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
