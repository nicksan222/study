/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reports typed missing record and invalid input failures for Page stores.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Reports typed missing record and invalid input failures for Page stores.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Private synchronous persistence stays inside Pages ownership; callers own                │
 * │ transaction scope.                                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';

export function required<T>(value: T | undefined | null): T {
  if (value == null) throw new StudyError('not_found', 'Page resource not found');

  return value;
}

export function invalid(message: string): never {
  throw new StudyError('invalid_input', message);
}
