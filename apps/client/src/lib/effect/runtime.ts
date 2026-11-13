import { StudyError } from '@study/contracts/errors';
import { Cause, Effect, Exit } from 'effect';

export async function runRequest<A>(
  operation: Effect.Effect<A, StudyError>,
  signal?: AbortSignal
): Promise<A> {
  if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError');

  const exit = await Effect.runPromiseExit(
    operation.pipe(
      Effect.match({
        onSuccess: (value) => ({ ok: true as const, value }),
        onFailure: (error) => ({ ok: false as const, error })
      })
    ),
    { signal }
  );

  if (signal?.aborted || (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)))
    throw new DOMException('Request aborted', 'AbortError');

  if (Exit.isFailure(exit))
    throw new StudyError('internal', 'Unexpected browser request failure', { cause: exit.cause });

  if (!exit.value.ok) {
    if (exit.value.error.kind === 'cancelled')
      throw new DOMException('Request aborted', 'AbortError');

    throw exit.value.error;
  }

  return exit.value.value;
}
