/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Builds schema-validated mutations with one typed transaction boundary.             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Rejects invalid input before invoking writes and keeps failures transactional.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Callers own domain writes; the store harness owns transaction execution and              │
 * │ normalization.                                                                           │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { Effect, Schema } from 'effect';

import { transaction } from '#server/platform/definitions/define-store';
import type { SyncResult, Transaction } from '#server/platform/definitions/define-store';

/** Validate before opening a transaction, retaining the schema's exact input type. */
export function validatedMutation<S extends Schema.Constraint, A>(definition: {
  readonly input: S;
  readonly message: string;
  readonly write: (tx: Transaction, input: NoInfer<S['Type']>) => A & SyncResult<A>;
}) {
  const valid = Schema.is(definition.input);

  return (input: S['Type']) =>
    valid(input)
      ? transaction<A>((tx) => definition.write(tx, input))
      : Effect.fail(new StudyError('invalid_input', definition.message));
}
