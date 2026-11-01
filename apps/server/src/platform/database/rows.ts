/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Converts a missing database row into a typed internal StudyError. Shared stores    │
 * │ use this helper when a query requires exactly one result.                                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports requireRow. Shared stores use this helper when a query requires exactly one    │
 * │   result.                                                                                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Store query implementations call requireRow when one row is mandatory; it owns no        │
 * │ database connection or transaction.                                                      │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';

export function requireRow<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new StudyError('internal', 'Required database row missing');

  return value;
}
