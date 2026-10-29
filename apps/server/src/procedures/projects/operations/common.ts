import { StudyError } from '#server/shared/errors/index';

export function nameOf(value: string): string {
  const name = value.trim();

  if (!name || [...name].length > 100)
    throw new StudyError('invalid_input', 'invalid project name');

  return name;
}

export function now(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export function titleOf(value: string): string {
  const title = value.trim();

  if (!title || [...title].length > 200)
    throw new StudyError('invalid_input', 'invalid session title');

  return title;
}
