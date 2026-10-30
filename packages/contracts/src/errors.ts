import { Schema } from 'effect';

export const errorKindSchema = Schema.Literals([
  'auth',
  'cancelled',
  'config',
  'internal',
  'invalid_input',
  'model_unavailable',
  'not_enough',
  'not_found',
  'rate_limited',
  'transient',
  'unsupported'
]);

export type ErrorKind = typeof errorKindSchema.Type;

export const failureSchema = Schema.Struct({
  kind: errorKindSchema,
  message: Schema.String,
  retryAfterMs: Schema.NullOr(Schema.Number)
});

export type Failure = typeof failureSchema.Type;

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
