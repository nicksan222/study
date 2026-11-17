/** @file Treats superseded note content as a completed no-op while retaining retryable generation failures. */

import type { ErrorKind } from '@study/contracts';
import { Effect } from 'effect';

export const ignoreUnavailableNoteContent = <E extends { readonly kind: ErrorKind }>(error: E) =>
  ['invalid_input', 'not_found', 'cancelled'].includes(error.kind)
    ? Effect.void
    : Effect.fail(error);
