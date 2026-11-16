/** @file Composes settings application operations behind the feature boundary. */

import type { UsageQuery } from '@study/contracts';

import { defineService } from '#server/platform/definitions/define-service';
import { useStore } from '#server/platform/definitions/define-store';
import { UsageStore } from '#server/platform/observability/usage-store';

import { settingsModelOperations } from './models.ts';
import { settingsPreferenceOperations } from './preferences.ts';

const make = function* () {
  const usage = yield* useStore(UsageStore);

  return {
    usage: (query: UsageQuery) => usage.usageReport(query),
    ...(yield* settingsModelOperations()),
    ...(yield* settingsPreferenceOperations())
  };
};

export const Settings = defineService('study/Settings', make);
