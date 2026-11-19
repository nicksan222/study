/** @file Stages WebDAV uploads before publishing them into their recovery slots. */

import { StudyError } from '@study/contracts';

import { objectPath, secureEndpoint, urlBackupAddress } from './backup-storage-http.ts';
import type {
  SendBackupRequest,
  StorageDestination,
  StorageStrategy
} from './backup-storage-http.ts';

function webdavTarget(destination: StorageDestination<'webdav'>, name: string, headers: Headers) {
  if (!destination.username || destination.username.includes(':') || !destination.password)
    throw new StudyError('invalid_input', 'Use a WebDAV username and app password');

  const url = objectPath(secureEndpoint(destination.url), name);
  const token = new TextEncoder()
    .encode(`${destination.username}:${destination.password}`)
    .toBase64();

  headers.set('authorization', `Basic ${token}`);

  return url;
}

export function webdavStrategy(send: SendBackupRequest): StorageStrategy<'webdav'> {
  return {
    ...urlBackupAddress(webdavTarget),
    async upload(destination, name, bytes, signal) {
      const headers = new Headers({ 'content-type': 'application/octet-stream' });
      const url = webdavTarget(destination, name, headers);
      // A failed upload must leave an existing recovery point available.
      const stage = new URL(url);

      stage.pathname += '.upload';
      await send(stage, { method: 'PUT', headers, body: bytes, signal });
      headers.delete('content-type');
      headers.set('destination', url.href);
      headers.set('overwrite', 'T');
      await send(stage, { method: 'MOVE', headers, signal });
    }
  };
}
