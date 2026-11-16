/** @file Composes auth persistence with canonical typed store declarations. */

import { defineStore } from '@study/server';

import { makeAuthGenerationStore, makeAuthStore } from './account.ts';
import { makeApiKeyStore } from './api-keys.ts';
import { makeAuthBackupStore } from './backup.ts';

export const AuthGenerationStore = defineStore({
  name: 'study/AuthGenerationStore',
  entity: { singular: 'credentialGeneration', plural: 'credentialGenerations' },
  make: (resources) => makeAuthGenerationStore(resources)
});

export const AuthStore = defineStore({
  name: 'study/AuthStore',
  entity: { singular: 'account', plural: 'accounts' },
  make: (resources) => makeAuthStore(resources)
});

export const ApiKeyStore = defineStore({
  name: 'study/ApiKeyStore',
  entity: { singular: 'apiKeys', plural: 'apiKeySets' },
  make: (resources) => makeApiKeyStore(resources)
});

export const AuthBackupStore = defineStore({
  name: 'study/AuthBackupStore',
  entity: { singular: 'backupSanitized', plural: 'backupSanitizedAccounts' },
  make: (resources) => makeAuthBackupStore(resources)
});
