import type { codes_error_kind } from '@study/db/schema';

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

/** A row guaranteed by a completed write or an aggregate query must exist. */
export function requireRow<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new StudyError('internal', 'Required database row missing');

  return value;
}
