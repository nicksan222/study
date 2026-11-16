/** @file Composes auth application operations behind the feature boundary. */

import { defineService } from '@study/server';
import type { Transaction } from '@study/server';

import { AuthBackupStore, AuthStore } from '#server/features/auth/store/index';

import { makeAuth } from './session.ts';

const make = makeAuth;

export const Auth = defineService('study/Auth', make, {
  validateBackup: (tx: Transaction) => tx.store(AuthBackupStore).backupSanitized(undefined),
  sanitizeBackup: (tx: Transaction) => tx.store(AuthStore).sanitizeBackup(undefined)
});
