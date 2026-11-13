import { projectIdSchema } from '@study/contracts/ids';
import { useSearch } from '@tanstack/react-router';
import { Schema } from 'effect';

export function usePage() {
  const { project } = useSearch({ from: '__root__' });

  return {
    project: project ? Schema.decodeUnknownSync(projectIdSchema)(BigInt(project)) : undefined
  };
}
