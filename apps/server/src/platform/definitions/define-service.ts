/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Constructs an Effect service from dependency-aware operations and wraps each       │
 * │ operation with error normalization and observability. The inferred service interface     │
 * │ retains operation inputs and outputs.                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports defineService. The inferred service interface retains operation inputs and     │
 * │   outputs.                                                                               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature modules use this typed declaration helper; it checks contracts but leaves domain │
 * │ data and business policy in the feature.                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { StudyError } from '@study/contracts/errors';
import { Context, Effect, Layer } from 'effect';

import { normalizeError } from '#server/platform/errors/classify-error';
import { observeOperation } from '#server/platform/observability/index';

type Operation = (...args: never[]) => Effect.Effect<unknown, unknown, unknown>;

type Wrapped<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Effect.Effect<infer V, infer E, infer R>
    ? (...args: A) => Effect.Effect<V, E | StudyError, R>
    : never;
};

/** Construct a native Effect service from its dependencies and instrument its operations. */
export function defineService<
  const Name extends string,
  T extends Record<string, Operation>,
  E,
  R,
  P extends Record<string, (...args: never[]) => unknown> = Record<never, never>
>(name: Name, make: Effect.Effect<T, E, R>, transactionParticipants?: P) {
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
                Effect.try({ try: () => handler(...args), catch: normalizeError }).pipe(
                  Effect.flatten
                )
              )
          ])
        );

        return wrapped as Wrapped<T>;
      })
    )
  );

  // Public synchronous participants let feature services share a caller-owned transaction.
  // They use that transaction's typed stores and must never hold it across an await.
  return Object.assign(key, { layer }, transactionParticipants);
}
