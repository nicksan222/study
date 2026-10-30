import { StudyError } from '@study/contracts/errors';
import { Cause, Effect, Exit } from 'effect';

export type Outcome<A> =
  | { status: 'ready'; value: A }
  | { status: 'error'; error: StudyError }
  | { status: 'cancelled' };

export async function runOperation<A>(
  operation: Effect.Effect<A, StudyError>,
  signal: AbortSignal
): Promise<Outcome<A>> {
  if (signal.aborted) return { status: 'cancelled' };

  const exit = await Effect.runPromiseExit(
    operation.pipe(
      Effect.match({
        onSuccess: (value): Outcome<A> => ({ status: 'ready', value }),
        onFailure: (error): Outcome<A> =>
          error.kind === 'cancelled' ? { status: 'cancelled' } : { status: 'error', error }
      })
    ),
    { signal }
  );

  if (signal.aborted) return { status: 'cancelled' };

  if (Exit.isSuccess(exit)) return exit.value;

  if (Cause.hasInterruptsOnly(exit.cause)) return { status: 'cancelled' };

  return {
    status: 'error',
    error: new StudyError('internal', 'Unexpected browser operation failure', { cause: exit.cause })
  };
}
