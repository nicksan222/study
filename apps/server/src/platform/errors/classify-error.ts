import { StudyError } from '@study/contracts/errors';
import type { Failure } from '@study/contracts/errors';
import { DrizzleQueryError } from '@study/db';

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
  const kind = errorKind(e?.errcode, code);

  const message = {
    not_found: 'Requested resource was not found',
    config: 'Required resource is not accessible',
    transient: 'Operation temporarily unavailable',
    invalid_input: 'Invalid operation input',
    internal: 'Operation failed'
  }[kind];

  return { kind, message, retryAfterMs: null };
}

function errorKind(errcode: number | undefined, code = '') {
  if (errcode === 787 || code === 'ENOENT') return 'not_found';

  if (['EACCES', 'EPERM'].includes(code)) return 'config';

  if (isTransient(errcode, code)) return 'transient';

  if (
    [275, 1555, 2067].includes(errcode ?? 0) ||
    ['EINVAL', 'ERR_INVALID_ARG_TYPE', 'ERR_OUT_OF_RANGE'].includes(code)
  )
    return 'invalid_input';

  return 'internal';
}

function isTransient(errcode: number | undefined, code: string) {
  return (
    (errcode !== undefined && [5, 6].includes(errcode & 0xff)) ||
    ['ETIMEDOUT', 'EINTR', 'ECONNRESET', 'ECONNABORTED', 'SQLITE_BUSY', 'SQLITE_LOCKED'].includes(
      code
    )
  );
}
