/** @file Registers the strategies used by the scheduler and backup settings. */

import { backupOAuth, storageStrategies, normalizeError } from '@study/server';
import type { BackupStorage, ManagedBackups } from '@study/server';
import { Effect } from 'effect';

import { folderBackup } from './folder.ts';
import { localBackup } from './local.ts';
import { oauthStrategy } from './oauth.ts';
import { backupAttempt } from './strategy.ts';
import type { BackupSlot, BackupStrategy, DestinationFor, DestinationKind } from './strategy.ts';

type Storage = ReturnType<typeof storageStrategies>;

function objectStrategy<K extends keyof Storage, R>(provider: {
  validate: (destination: DestinationFor<K>) => void;
  location: (destination: DestinationFor<K>) => string;
  upload: (
    destination: DestinationFor<K>,
    name: string,
    bytes: Uint8Array<ArrayBuffer>,
    signal: AbortSignal
  ) => Promise<void>;
}): BackupStrategy<K, R> {
  return {
    prepare: (destination) =>
      Effect.try({ try: () => provider.validate(destination), catch: normalizeError }).pipe(
        Effect.as(destination)
      ),
    location: provider.location,
    publish: (destination, { name, bytes }) =>
      backupAttempt((signal) => provider.upload(destination, name, bytes, signal))
  };
}

export function createBackupStrategies<R>(
  owner: ManagedBackups,
  request: BackupStorage['Service']['request']
) {
  const oauth = backupOAuth(request);
  const storage = storageStrategies(request);
  const strategies: { [K in DestinationKind]: BackupStrategy<K, R> } = {
    local: localBackup(owner),
    folder: folderBackup(owner),
    s3: objectStrategy(storage.s3),
    webdav: objectStrategy(storage.webdav),
    'azure-blob': objectStrategy(storage['azure-blob']),
    onedrive: oauthStrategy(oauth, 'onedrive'),
    'google-drive': oauthStrategy(oauth, 'google-drive'),
    dropbox: oauthStrategy(oauth, 'dropbox')
  };

  return {
    oauth,
    prepare: <K extends DestinationKind>(destination: DestinationFor<K>) =>
      strategies[destination.kind].prepare?.(destination) ?? Effect.succeed(destination),
    location: <K extends DestinationKind>(destination: DestinationFor<K>) =>
      strategies[destination.kind].location(destination),
    publish: <K extends DestinationKind>(destination: DestinationFor<K>, slot: BackupSlot<R>) =>
      strategies[destination.kind].publish(destination, slot)
  };
}
