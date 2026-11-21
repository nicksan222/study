import { projectIdSchema } from '@study/contracts';
import { useSearch } from '@tanstack/react-router';

export function usePage() {
  const { project } = useSearch({ from: '__root__' });

  return { project: project ? projectIdSchema.make(BigInt(project)) : undefined };
}
