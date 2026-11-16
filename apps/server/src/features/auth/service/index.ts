/** @file Composes auth application operations behind the feature boundary. */

import { AuthBackupStore, AuthStore } from '#server/features/auth/store/index';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';

import { makeAuth } from './session.ts';

const make = makeAuth;

export const Auth = defineService('study/Auth', make, {
  validateBackup: (tx: Transaction) => tx.store(AuthBackupStore).backupSanitized(undefined),
  sanitizeBackup: (tx: Transaction) => tx.store(AuthStore).sanitizeBackup(undefined)
});
