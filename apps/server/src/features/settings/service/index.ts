/** @file Composes settings application operations behind the feature boundary. */

import type { UsageQuery } from '@study/contracts';
import { defineService, useStore, UsageStore } from '@study/server';

import { makeModelCatalogRefresh } from './model-catalog.ts';
import { modelUpdateOperations } from './model-updates.ts';
import { settingsModelOperations } from './models.ts';
import { settingsPreferenceOperations } from './preferences.ts';

const make = function* () {
  const usage = yield* useStore(UsageStore);
  const models = yield* settingsModelOperations();
  const updates = yield* modelUpdateOperations();

  return {
    usage: (query: UsageQuery) => usage.usageReport(query),
    ...models,
    ...updates,
    refreshModelRecommendations: makeModelCatalogRefresh(models.model, updates.refreshModelCatalog),
    ...(yield* settingsPreferenceOperations())
  };
};

export const Settings = defineService('study/Settings', make);
