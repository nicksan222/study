/** @file Composes settings application operations behind the feature boundary. */

import type { UsageQuery } from '@study/contracts';
import { ChatGptSession, defineService, transaction, useStore, UsageStore } from '@study/server';
import { Effect, Option, Semaphore } from 'effect';

import {
  AutomaticBackupStore,
  sanitizeAutomaticBackup,
  validateAutomaticBackup
} from '#server/features/settings/store/automatic-backup';
import type { AutomaticBackupState } from '#server/features/settings/store/automatic-backup';

import { makeModelCatalogRefresh } from './model-catalog.ts';
import { modelUpdateOperations } from './model-updates.ts';
import { settingsModelOperations } from './models.ts';
import { settingsPreferenceOperations } from './preferences.ts';

const make = function* () {
  const backups = yield* useStore(AutomaticBackupStore);
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
    automaticBackupState: () => backups.state(undefined),
    saveAutomaticBackupState: (state: AutomaticBackupState) =>
      transaction((tx) => tx.store(AutomaticBackupStore).save(state)),
    usage: (query: UsageQuery) => usage.usageReport(query),
    ...models,
    ...updates,
    refreshModelRecommendations: (session: Parameters<typeof refresh>[0]) =>
      catalogLock.withPermit(refresh(session)),
    ...(yield* settingsPreferenceOperations())
  };
};

export const Settings = defineService('study/Settings', make, {
  sanitizeAutomaticBackup,
  validateAutomaticBackup
});
