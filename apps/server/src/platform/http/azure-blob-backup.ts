/** @file Publishes backup slots as Azure block blobs using a configured SAS. */

import { StudyError } from '@study/contracts';

import { liveClock } from '#server/platform/time/index';

import { objectPath, secureEndpoint, urlBackupAddress } from './backup-storage-http.ts';
import type {
  SendBackupRequest,
  StorageDestination,
  StorageStrategy
} from './backup-storage-http.ts';

const sasFields = new Set([
  'sv',
  'ss',
  'srt',
  'sp',
  'se',
  'st',
  'spr',
  'sip',
  'si',
  'sr',
  'sig',
  'ses',
  'sdd',
  'skoid',
  'sktid',
  'skt',
  'ske',
  'sks',
  'skv',
  'saoid',
  'suoid',
  'scid',
  'rscc',
  'rscd',
  'rsce',
  'rscl',
  'rsct'
]);

function azureTarget(
  destination: StorageDestination<'azure-blob'>,
  name: string,
  headers: Headers
) {
  const url = secureEndpoint(destination.url);
  const token = destination.sas.trim().replace(/^\?/, '');
  const params = new URLSearchParams(token);
  const fields = [...params.keys()];

  if (url.pathname === '/' || !validSas(params, fields))
    throw new StudyError('invalid_input', 'Use an Azure container URL and its SAS token');

  objectPath(url, name, destination.prefix);
  // Keep the query bytes supplied by Azure, including encoded plus and padding in the signature.
  url.search = token;
  headers.set('x-ms-blob-type', 'BlockBlob');
  headers.set('x-ms-version', '2021-12-02');
  headers.set('x-ms-date', now().toUTCString());

  return url;
}

function validSas(params: URLSearchParams, fields: readonly string[]) {
  const resource = params.get('sr');
  const permissions = params.get('sp');

  return (
    Boolean(params.get('sig') && params.get('sv')) &&
    (!resource || resource === 'c' || resource === 'd') &&
    Boolean(permissions ? permissions.includes('w') : params.get('si')) &&
    new Set(fields).size === fields.length &&
    fields.every((key) => sasFields.has(key))
  );
}

function now() {
  return new Date(liveClock().currentTimeMillisUnsafe());
}

export function azureBlobStrategy(send: SendBackupRequest): StorageStrategy<'azure-blob'> {
  return {
    ...urlBackupAddress(azureTarget),
    async upload(destination, name, bytes, signal) {
      const headers = new Headers({ 'content-type': 'application/octet-stream' });
      const url = azureTarget(destination, name, headers);

      await send(url, { method: 'PUT', headers, body: bytes, signal });
    }
  };
}
