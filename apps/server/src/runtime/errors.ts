import type { Locale } from '@study/localization';
import { text } from '@study/localization';
import { TRPCError } from '@trpc/server';

import type { ErrorKind } from '#server/shared/errors/index';
import { classifyError, StudyError } from '#server/shared/errors/index';

const codes = {
  invalid_input: 'BAD_REQUEST',
  auth: 'UNAUTHORIZED',
  cancelled: 'CLIENT_CLOSED_REQUEST',
  transient: 'SERVICE_UNAVAILABLE',
  rate_limited: 'TOO_MANY_REQUESTS',
  config: 'PRECONDITION_FAILED',
  model_unavailable: 'PRECONDITION_FAILED',
  unsupported: 'NOT_IMPLEMENTED',
  not_enough: 'PRECONDITION_FAILED',
  not_found: 'NOT_FOUND',
  internal: 'INTERNAL_SERVER_ERROR'
} as const;

const messages = {
  invalid_input: 'ActionError',
  auth: 'ProblemSignIn',
  cancelled: 'StatusStopped',
  transient: 'ProblemConnection',
  rate_limited: 'ProblemBusy',
  config: 'ProblemSetup',
  model_unavailable: 'ProblemModel',
  unsupported: 'ProblemNotReadable',
  not_enough: 'ProblemNotEnough',
  not_found: 'ProblemGone',
  internal: 'ProblemUnknown'
} as const;

export function businessFailure(error: unknown) {
  if (error instanceof TRPCError) {
    if (error.cause instanceof StudyError) return classifyError(error.cause);

    if (error.code === 'BAD_REQUEST')
      return classifyError(new StudyError('invalid_input', error.message));

    if (error.code === 'NOT_FOUND')
      return classifyError(new StudyError('not_found', error.message));

    if (error.code === 'CLIENT_CLOSED_REQUEST')
      return classifyError(new StudyError('cancelled', error.message));

    return classifyError(error.cause ?? error);
  }

  return classifyError(error);
}

export function serverError(
  error: unknown,
  language: Locale,
  cancelled = false
): TRPCError & {
  kind: ErrorKind;
} {
  const failure = businessFailure(cancelled ? new StudyError('cancelled', 'cancelled') : error);
  const cause = new StudyError(failure.kind, failure.message, {
    retryAfterMs: failure.retryAfterMs
  });

  return Object.assign(
    new TRPCError({
      code: codes[failure.kind],
      message: text(language, messages[failure.kind]),
      cause
    }),
    {
      kind: failure.kind
    }
  );
}

export function invalid(message: string): never {
  throw new StudyError('invalid_input', message);
}
