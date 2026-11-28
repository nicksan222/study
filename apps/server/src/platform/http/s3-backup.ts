/** @file Writes backup slots to S3 with explicit credentials and a SigV4-signed PUT. */

import { StudyError } from '@study/contracts';
import { CryptoHasher } from 'bun';

import { liveClock } from '#server/platform/time/index';

import {
  exampleBackupName,
  encodeSegment,
  objectPath,
  secureEndpoint
} from './backup-storage-http.ts';
import type {
  SendBackupRequest,
  StorageDestination,
  StorageStrategy
} from './backup-storage-http.ts';

function s3DefaultEndpoint(region: string) {
  const domain = region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com';

  return `https://s3.${region}.${domain}`;
}

function s3Target(destination: StorageDestination<'s3'>, name: string) {
  const { region, bucket, accessKeyId, secretAccessKey, prefix } = destination;

  if (
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(region) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    !/^[\w.-]+$/.test(accessKeyId) ||
    !secretAccessKey
  )
    throw new StudyError('invalid_input', 'Check the S3 bucket, region, and credentials');

  const url = secureEndpoint(destination.endpoint ?? s3DefaultEndpoint(region));

  try {
    url.pathname = url.pathname
      .split('/')
      .map((part) => encodeSegment(decodeURIComponent(part)))
      .join('/');
  } catch {
    throw new StudyError('invalid_input', 'The S3 endpoint contains an invalid encoded path');
  }

  const key = prefix ? `${prefix.replace(/\/$/, '')}/${name}` : name;

  if (new TextEncoder().encode(key).length > 1024)
    throw new StudyError('invalid_input', 'The S3 object key would exceed 1024 bytes');

  return objectPath(url, name, prefix ? `${bucket}/${prefix}` : bucket);
}

interface S3Credentials {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

function sha256(input: string | Uint8Array) {
  return new CryptoHasher('sha256').update(input).digest('hex');
}

function hmac(key: string | Uint8Array, input: string) {
  return new CryptoHasher('sha256', key).update(input).digest();
}

/** Sign the already encoded object path and the exact bytes sent by PUT. */
export function signS3Put(
  url: URL,
  headers: Headers,
  bytes: Uint8Array,
  credentials: S3Credentials,
  now: Date
) {
  const timestamp = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const shortDate = timestamp.slice(0, 8);
  const payload = sha256(bytes);

  headers.set('host', url.host);
  headers.set('x-amz-content-sha256', payload);
  headers.set('x-amz-date', timestamp);

  const keys = [...headers.keys()].sort();
  const signed = keys.join(';');
  const canonicalHeaders = keys.map((key) => `${key}:${headers.get(key)}\n`).join('');
  const canonical = ['PUT', url.pathname, '', canonicalHeaders, signed, payload].join('\n');
  const scope = `${shortDate}/${credentials.region}/s3/aws4_request`;
  const algorithm = 'AWS4-HMAC-SHA256';
  const message = [algorithm, timestamp, scope, sha256(canonical)].join('\n');
  const daily = hmac(`AWS4${credentials.secretAccessKey}`, shortDate);
  const service = hmac(hmac(daily, credentials.region), 's3');
  const signature = Buffer.from(hmac(hmac(service, 'aws4_request'), message)).toString('hex');

  headers.set(
    'authorization',
    `${algorithm} Credential=${credentials.accessKeyId}/${scope},SignedHeaders=${signed},Signature=${signature}`
  );
}

export function s3Strategy(send: SendBackupRequest): StorageStrategy<'s3'> {
  return {
    validate: (destination) => s3Target(destination, exampleBackupName),
    location({ bucket, prefix }) {
      return prefix ? `${bucket}/${prefix}` : bucket;
    },
    async upload(destination, name, bytes, signal) {
      const url = s3Target(destination, name);
      const headers = new Headers({ 'content-type': 'application/octet-stream' });

      signS3Put(url, headers, bytes, destination, new Date(liveClock().currentTimeMillisUnsafe()));
      await send(url, { method: 'PUT', headers, body: bytes, signal });
    }
  };
}
