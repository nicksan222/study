/** @file Publishes automatic backups to a user-selected folder. */

import type { ManagedBackups } from '@study/server';
import { Effect } from 'effect';

import { backupAttempt } from './strategy.ts';
import type { BackupStrategy } from './strategy.ts';

export function folderBackup<R>(owner: ManagedBackups): BackupStrategy<'folder', R> {
  return {
    prepare: (input) =>
      backupAttempt(() => owner.automaticFolder(input.path)).pipe(
        Effect.map((path) => ({ ...input, path }))
      ),
    location: (input) => input.path,
    publish: (input, { name, bytes }) =>
      backupAttempt(() => owner.writeAutomaticFolder(name, bytes, input.path)).pipe(
        Effect.uninterruptible
      )
  };
}
