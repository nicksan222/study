/** @file Publishes automatic backups to Study's private local directory. */

import type { ManagedBackups } from '@study/server';
import { Effect } from 'effect';

import { backupAttempt } from './strategy.ts';
import type { BackupStrategy } from './strategy.ts';

export function localBackup<R>(owner: ManagedBackups): BackupStrategy<'local', R> {
  return {
    location: () => owner.automaticFolderPath,
    publish: (_, { name, bytes }) =>
      backupAttempt(() => owner.writeAutomaticFolder(name, bytes)).pipe(Effect.uninterruptible)
  };
}
