/** @file Composes themes application operations behind the feature boundary. */

import { ThemeBackupStore } from '#server/features/themes/store/index';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';

import { themeOperations } from './themes.ts';

export const Themes = defineService(
  'study/Themes',
  function* () {
    return {
      ...(yield* themeOperations())
    };
  },
  { validateBackup: (tx: Transaction) => tx.store(ThemeBackupStore).backupTheme(undefined) }
);
