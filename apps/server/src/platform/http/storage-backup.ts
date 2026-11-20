/** @file Composes the object backup strategies with their shared HTTPS transport. */

import { azureBlobStrategy } from './azure-blob-backup.ts';
import { sendBackupRequest } from './backup-storage-http.ts';
import type { StorageKind, StorageStrategy } from './backup-storage-http.ts';
import { s3Strategy } from './s3-backup.ts';
import { webdavStrategy } from './webdav-backup.ts';

export function storageStrategies(request?: Parameters<typeof sendBackupRequest>[0]) {
  const send = sendBackupRequest(request);

  return {
    s3: s3Strategy(send),
    webdav: webdavStrategy(send),
    'azure-blob': azureBlobStrategy(send)
  } satisfies { [K in StorageKind]: StorageStrategy<K> };
}
