/** @file Composes settings persistence with canonical typed store declarations. */

import { defineStore } from '@study/server';

import { makeSettingsStore } from './preferences.ts';

export const SettingsStore = defineStore({
  name: 'study/SettingsStore',
  entity: { singular: 'preference', plural: 'preferences' },
  make: (resources) => makeSettingsStore(resources)
});
