import { StudyError } from '@study/contracts/errors';
import type { Block, Document } from '@study/contracts/sources/document';

export const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

export function checkInput(bytes: Uint8Array, limit: number, signal?: AbortSignal): void {
  checkAbort(signal);

  if (!Number.isSafeInteger(limit) || limit <= 0 || bytes.byteLength > limit)
    throw new StudyError('invalid_input', 'Source exceeds the reader size limit');
}

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new StudyError('cancelled', 'Reading was cancelled', {
      cause: signal.reason
    });
}

export function document(
  blocks: Block[],
  extractor: string,
  pageCount: number | null = null,
  provider: string | null = null
): Document {
  return {
    blocks,
    meta: {
      extractor,
      extractorVersion: 1,
      provider,
      durationMs: null,
      pageCount,
      refiners: [],
      waitingFor: [],
      corrected: false
    }
  };
}
