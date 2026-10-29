import { DrizzleQueryError } from '@study/db';

import { StudyError } from '#server/shared/errors/index';
import type { ErrorKind, Failure } from '#server/shared/errors/index';

export function classifyError(error: unknown): Failure {
  if (error instanceof DrizzleQueryError) return classifyError(error.cause);

  if (error instanceof StudyError)
    return {
      kind: error.kind,
      message: error.message,
      retryAfterMs: error.retryAfterMs
    };

  const e = error as {
    code?: string;
    errcode?: number;
    message?: string;
  } | null;
  const code = e?.code;
  const kind: ErrorKind =
    e?.errcode === 787 || code === 'ENOENT'
      ? 'not_found'
      : code === 'EACCES' || code === 'EPERM'
        ? 'config'
        : (e?.errcode !== undefined && [5, 6].includes(e.errcode & 0xff)) ||
            [
              'ETIMEDOUT',
              'EINTR',
              'ECONNRESET',
              'ECONNABORTED',
              'SQLITE_BUSY',
              'SQLITE_LOCKED'
            ].includes(code ?? '')
          ? 'transient'
          : [275, 1555, 2067].includes(e?.errcode ?? 0) ||
              ['EINVAL', 'ERR_INVALID_ARG_TYPE', 'ERR_OUT_OF_RANGE'].includes(code ?? '')
            ? 'invalid_input'
            : 'internal';

  return { kind, message: e?.message ?? String(error), retryAfterMs: null };
}
