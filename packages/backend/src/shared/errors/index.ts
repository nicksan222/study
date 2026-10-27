import type { codes_error_kind } from '@study/db/schema';
import { DrizzleQueryError } from 'drizzle-orm';

export type ErrorKind = (typeof codes_error_kind.$inferSelect)['code'];

export interface Failure {
  kind: ErrorKind;
  message: string;
  retryAfterMs: number | null;
}

export class StudyError extends Error {
  readonly kind: ErrorKind;
  readonly retryAfterMs: number | null;

  constructor(
    kind: ErrorKind,
    message: string,
    options?: { cause?: unknown; retryAfterMs?: number | null }
  ) {
    super(message, { cause: options?.cause });
    this.name = 'StudyError';
    this.kind = kind;
    this.retryAfterMs = options?.retryAfterMs ?? null;
  }
}

export function isRetryable(kind: ErrorKind): boolean {
  return kind === 'transient' || kind === 'rate_limited';
}

export function needsSetup(kind: ErrorKind): boolean {
  return kind === 'auth' || kind === 'config' || kind === 'model_unavailable';
}

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
