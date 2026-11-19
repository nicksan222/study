/** @file Shared HTTPS request, path handling, and contracts for object backup strategies. */

import { StudyError } from '@study/contracts';
import type { ErrorKind, storageBackupDestinationSchema } from '@study/contracts';
import type { Clock } from 'effect';

import { streamingFetch } from './index.ts';

type Fetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

export type StorageKind = typeof storageBackupDestinationSchema.Type.kind;

export type StorageDestination<K extends StorageKind> = Extract<
  typeof storageBackupDestinationSchema.Type,
  { kind: K }
>;

export interface StorageStrategy<K extends StorageKind> {
  validate(destination: StorageDestination<K>): void;
  location(destination: StorageDestination<K>): string;
  upload(
    destination: StorageDestination<K>,
    name: string,
    bytes: Uint8Array<ArrayBuffer>,
    signal: AbortSignal
  ): Promise<void>;
}

/** Validate an object key at the size of a real backup slot name. */
export const exampleBackupName = 'Study-00000000-0000-0000-0000-000000000000-1.studybackup';

export function urlBackupAddress<D extends { readonly url: string }>(
  target: (destination: D, name: string, headers: Headers) => URL
) {
  return {
    validate: (destination: D) => target(destination, exampleBackupName, new Headers()),
    location: (destination: D) => destination.url
  };
}

export function secureEndpoint(address: string) {
  const url = URL.parse(address);

  if (
    !url ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    address.includes('?') ||
    address.includes('#')
  )
    throw new StudyError(
      'invalid_input',
      'Use an HTTPS backup URL without credentials or parameters'
    );

  return url;
}

export function encodeSegment(segment: string) {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase()
  );
}

export function objectPath(url: URL, name: string, prefix = '') {
  const parts = prefix.replace(/\/$/, '').split('/');
  const segments = prefix ? [...parts, name] : [name];

  if (segments.some((value) => !value || value === '.' || value === '..' || value.includes('/')))
    throw new StudyError('invalid_input', 'Backup prefixes must contain named path segments');

  try {
    url.pathname = [url.pathname.replace(/\/$/, ''), ...segments.map(encodeSegment)].join('/');

    return url;
  } catch {
    throw new StudyError('invalid_input', 'Backup prefixes must be valid Unicode');
  }
}

function uploadFailure(status: number): ErrorKind {
  if (status === 401 || status === 403) return 'auth';

  if (status === 429) return 'rate_limited';

  if (status === 408 || status >= 500) return 'transient';

  return 'config';
}

export function backupUploadTimeout(body: RequestInit['body'], minimumMs = 120_000) {
  const bytes = ArrayBuffer.isView(body) || body instanceof ArrayBuffer ? body.byteLength : 0;

  // Allow two minutes for setup and response, plus a transfer at 16 KiB/s.
  return Math.max(minimumMs, 120_000 + Math.ceil((bytes * 1000) / (16 * 1024)));
}

export function sendBackupRequest(request?: Fetch, clock?: Clock.Clock) {
  return async (url: URL, init: RequestInit): Promise<void> => {
    let response: Response;

    try {
      response = await streamingFetch(url, init, {
        timeoutMs: backupUploadTimeout(init.body),
        maxBytes: 64 * 1024,
        fetch: request,
        clock,
        sensitive: true
      });
      await response.body?.cancel();
    } catch {
      // Some transport failures include the entire request URL or headers.
      throw new StudyError(
        init.signal?.aborted ? 'cancelled' : 'transient',
        'Backup upload request failed'
      );
    }

    if (!response.ok || response.status === 207)
      throw new StudyError(
        uploadFailure(response.status),
        `Backup storage returned HTTP ${response.status}`
      );
  };
}

export type SendBackupRequest = ReturnType<typeof sendBackupRequest>;
