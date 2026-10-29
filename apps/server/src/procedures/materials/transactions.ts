import { DrizzleQueryError } from 'drizzle-orm';
import { ZodError } from 'zod';

import type { ServerContext } from '#server/runtime/context';
import { StudyError } from '#server/shared/errors/index';

/** SQLite owns the last word on snapshot integrity; classify by code, never trigger text. */
export function materialTransaction<T>(store: ServerContext, work: () => T): T {
  try {
    return store.transaction(work);
  } catch (error) {
    if (error instanceof ZodError)
      throw new StudyError('invalid_input', 'Invalid material input', { cause: error });

    let cause: unknown = error;

    while (cause instanceof DrizzleQueryError) cause = cause.cause;

    if (
      cause instanceof Error &&
      'errcode' in cause &&
      typeof cause.errcode === 'number' &&
      (cause.errcode & 255) === 19
    )
      throw new StudyError('invalid_input', 'Material integrity constraint failed', {
        cause: error
      });

    throw error;
  }
}
