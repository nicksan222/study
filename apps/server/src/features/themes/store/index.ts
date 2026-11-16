/** @file Composes themes persistence with canonical typed store declarations. */

import { defineStore } from '#server/platform/definitions/define-store';

import { makeThemeBackupStore } from './backup.ts';
import { makeThemeSelectionStore } from './selection.ts';
import { makeThemeStore } from './themes.ts';

export const ThemeBackupStore = defineStore({
  name: 'study/ThemeBackupStore',
  entity: { singular: 'backupTheme', plural: 'backupThemes' },
  make: (resources) => makeThemeBackupStore(resources)
});

export const ThemeSelectionStore = defineStore({
  name: 'study/ThemeSelectionStore',
  entity: { singular: 'selection', plural: 'selections' },
  make: (resources) => makeThemeSelectionStore(resources)
});

export const ThemeStore = defineStore({
  name: 'study/ThemeStore',
  entity: { singular: 'theme', plural: 'themes' },
  make: (resources) => makeThemeStore(resources)
});
