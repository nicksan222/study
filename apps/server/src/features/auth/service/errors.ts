/** @file Owns errors within this feature. */

import { StudyError } from '@study/contracts';

import { classifyError } from '#server/platform/errors/classify-error';

export function authFailure(cause: unknown): StudyError {
  if (cause instanceof StudyError) return cause;

  const failure = classifyError(cause);

  return new StudyError(failure.kind, failure.message, {
    cause,
    retryAfterMs: failure.retryAfterMs
  });
}

export const invalid = (message: string) => new StudyError('invalid_input', message);
