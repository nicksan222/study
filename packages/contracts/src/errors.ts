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

const failureResourceSchema = Schema.Literals(['ai_capacity', 'note_practice_evidence']);

type FailureResource = typeof failureResourceSchema.Type;

export const failureSchema = Schema.Struct({
  kind: errorKindSchema,
  resource: Schema.optionalKey(failureResourceSchema),
  message: Schema.String,
  retryAfterMs: Schema.NullOr(Schema.Number)
});

export type Failure = typeof failureSchema.Type;

/** Encode only public failure fields, including non-enumerable Error.message. */
export const encodeFailure = Schema.encodeSync(failureSchema);

export class StudyError extends Error {
  readonly kind: ErrorKind;
  readonly retryAfterMs: number | null;
  declare readonly resource?: FailureResource;

  constructor(
    kind: ErrorKind,
    message: string,
    options?: { cause?: unknown; retryAfterMs?: number | null; resource?: FailureResource }
  ) {
    super(message, { cause: options?.cause });

    if (options?.resource) this.resource = options.resource;

    this.name = 'StudyError';
    this.kind = kind;
    this.retryAfterMs = options?.retryAfterMs ?? null;
  }
}

export function isRetryable(kind: ErrorKind): boolean {
  return kind === 'transient' || kind === 'rate_limited';
}

export function needsSetup(kind: ErrorKind): kind is 'auth' | 'config' | 'model_unavailable' {
  return kind === 'auth' || kind === 'config' || kind === 'model_unavailable';
}
