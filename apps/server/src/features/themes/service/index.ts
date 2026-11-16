/** @file Composes themes application operations behind the feature boundary. */

import { defineService } from '@study/server';
import type { Transaction } from '@study/server';

import { ThemeBackupStore } from '#server/features/themes/store/index';

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
