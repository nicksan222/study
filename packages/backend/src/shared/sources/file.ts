import { fstatSync, readSync } from 'node:fs';

import { StudyError } from '#backend/shared/errors/index';

import { MAX_SOURCE_BYTES } from './sniff.ts';

/** Read exactly the measured file from an already-open descriptor, detecting growth or truncation. */
export function readImportFile(fd: number): Buffer {
  const stat = fstatSync(fd);

  if (!stat.isFile()) throw new StudyError('invalid_input', 'the path is not a regular file');

  if (stat.size === 0 || stat.size > MAX_SOURCE_BYTES)
    throw new StudyError('invalid_input', 'file size is outside the allowed range');

  return readMeasuredFile(fd, stat.size);
}

/** Read no more than the measured length plus one byte. */
export function readMeasuredFile(fd: number, size: number): Buffer {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_SOURCE_BYTES)
    throw new StudyError('invalid_input', 'file size is outside the allowed range');

  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;

  while (offset < size) {
    const n = readSync(fd, bytes, offset, size - offset, null);

    if (!n) break;

    offset += n;
  }

  const extra = Buffer.allocUnsafe(1);

  if (offset !== size || readSync(fd, extra, 0, 1, null) !== 0)
    throw new StudyError('invalid_input', 'the file changed while it was being imported');

  return bytes;
}
