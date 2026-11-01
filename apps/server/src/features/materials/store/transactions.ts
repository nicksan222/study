/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Provides transaction helpers for composing atomic material store operations.       │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps related material mutations atomic through shared database transactions.          │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the materials service applies policy and        │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { DrizzleQueryError } from '@study/db';
import { Schema } from 'effect';

/** SQLite owns the last word on snapshot integrity; classify by code, never trigger text. */
export function materialIntegrity<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (Schema.isSchemaError(error))
      throw new StudyError('invalid_input', 'Invalid material input', { cause: error });

    let cause: unknown = error;

    while (cause instanceof DrizzleQueryError) cause = cause.cause;

    if (
      cause instanceof Error &&
      'errcode' in cause &&
      typeof cause.errcode === 'number' &&
      (cause.errcode & 255) === 19
    )
      throw new StudyError('invalid_input', 'Material integrity constraint failed', {
        cause: error
      });

    throw error;
  }
}
