import { failureSchema, StudyError } from '@study/contracts/errors';
import { Schema } from 'effect';

const isFailure = Schema.is(failureSchema);

export function toStudyError(cause: unknown): StudyError {
  if (cause instanceof StudyError) return cause;

  if (isFailure(cause))
    return new StudyError(cause.kind, cause.message, {
      cause,
      retryAfterMs: cause.retryAfterMs
    });

  return new StudyError('transient', 'Browser transport failed', { cause });
}
