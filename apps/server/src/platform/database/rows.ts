import { StudyError } from '@study/contracts/errors';

export function requireRow<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new StudyError('internal', 'Required database row missing');

  return value;
}
