import { StudyError } from '@study/contracts/errors';
import { Context, Effect, Layer } from 'effect';

import { classifyError } from '#server/platform/errors/classify-error';
import { observeOperation } from '#server/platform/observability/index';

function failure(error: unknown): StudyError {
  if (error instanceof StudyError) return error;

  const classified = classifyError(error);

  return new StudyError(classified.kind, classified.message, {
    cause: error,
    retryAfterMs: classified.retryAfterMs
  });
}

type Operation = (...args: never[]) => Effect.Effect<unknown, unknown, unknown>;

type Wrapped<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Effect.Effect<infer V, infer E, infer R>
    ? (...args: A) => Effect.Effect<V, E | StudyError, R>
    : never;
};

/** Construct a native Effect service from its dependencies and instrument its operations. */
export function defineService<const Name extends string, T extends Record<string, Operation>, E, R>(
  name: Name,
  make: Effect.Effect<T, E, R>
) {
  const key = Context.Service<Wrapped<T>>(name);
  const layer = Layer.effect(
    key,
    make.pipe(
      Effect.map((operations) => {
        const wrapped = Object.fromEntries(
          Object.entries(operations).map(([operation, handler]) => [
            operation,
            (...args: never[]) =>
              observeOperation(
                `${name}.${operation}`,
                Effect.try({ try: () => handler(...args), catch: failure }).pipe(
                  Effect.flatMap((effect) => effect)
                )
              )
          ])
        );

        return wrapped as Wrapped<T>;
      })
    )
  );

  return Object.assign(key, { layer });
}
