/** @file Composes settings application operations behind the feature boundary. */

import type { UsageQuery } from '@study/contracts';
import { defineService, useStore, UsageStore } from '@study/server';

import { modelUpdateOperations } from './model-updates.ts';
import { settingsModelOperations } from './models.ts';
import { settingsPreferenceOperations } from './preferences.ts';

const make = function* () {
  const usage = yield* useStore(UsageStore);

  return {
    usage: (query: UsageQuery) => usage.usageReport(query),
    ...(yield* settingsModelOperations()),
    ...(yield* modelUpdateOperations()),
    ...(yield* settingsPreferenceOperations())
  };
};

export const Settings = defineService('study/Settings', make);
