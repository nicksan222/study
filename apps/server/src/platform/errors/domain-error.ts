import { StudyError } from '@study/contracts/errors';

export function invalid(message: string): never {
  throw new StudyError('invalid_input', message);
}
