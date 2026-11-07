import { StudyError } from '@study/contracts/errors';
import {
  MAX_INTEGRATION_BYTES,
  integrationInputSchema
} from '@study/contracts/integrations/schemas';
import { Schema } from 'effect';

/** Portable relative paths only; no adapter may read the host filesystem. */
export function integrationFiles(input: typeof integrationInputSchema.Type) {
  const parsed = Schema.decodeUnknownSync(integrationInputSchema)(input);
  const files = new Map<string, (typeof parsed.files)[number]>();
  let size = 0;

  for (const file of parsed.files) {
    if (
      /^[A-Za-z]:|^\/|\\/.test(file.path) ||
      [...file.path].some((character) => character.charCodeAt(0) < 32) ||
      file.path.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new StudyError('invalid_input', 'Unsafe integration path');

    if (files.has(file.path)) throw new StudyError('invalid_input', 'Duplicate integration path');

    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content))
      throw new StudyError('invalid_input', 'Invalid integration file encoding');

    size += Buffer.byteLength(file.content, 'base64');

    if (size > MAX_INTEGRATION_BYTES)
      throw new StudyError('invalid_input', 'Integration exceeds transfer limit');

    files.set(file.path, file);
  }

  return files;
}
