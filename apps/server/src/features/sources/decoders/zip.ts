/** @file Reads Office package entries directly from the original archive. */

import { StudyError } from '@study/contracts';
import { fromBufferPromise } from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';

import { checkAbort } from './common.ts';

export function openZip(bytes: Uint8Array) {
  return fromBufferPromise(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
    lazyEntries: true,
    validateEntrySizes: true,
    strictFileNames: true
  });
}

export function nextZipEntry(zip: ZipFile): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      zip.off('entry', onEntry);
      zip.off('end', onEnd);
      zip.off('error', onError);
    };
    const onEntry = (entry: Entry) => {
      cleanup();
      resolve(entry);
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    zip.once('entry', onEntry);
    zip.once('end', onEnd);
    zip.once('error', onError);
    zip.readEntry();
  });
}

export async function readZipXml(
  zip: ZipFile,
  entry: Entry,
  limit: number,
  signal?: AbortSignal
): Promise<string> {
  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let size = 0;
  const abort = () => stream.destroy(new StudyError('cancelled', 'Reading was cancelled'));

  signal?.addEventListener('abort', abort, { once: true });

  try {
    checkAbort(signal);

    for await (const chunk of stream) {
      size += chunk.length;

      if (size > entry.uncompressedSize || size > limit)
        throw new StudyError('invalid_input', 'Office XML exceeds the size limit');

      chunks.push(chunk);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    stream.destroy();
  }

  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
