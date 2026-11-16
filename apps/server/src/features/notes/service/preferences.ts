/** @file Owns preferences within this feature. */

import { Effect } from 'effect';

import { Settings } from '#server/features/settings/index';

export function readWorkspacePreferences() {
  return Settings.use((settings) => settings.workspacePreferences()).pipe(
    Effect.provide(Settings.layer)
  );
}
