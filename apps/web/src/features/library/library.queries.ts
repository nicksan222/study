import type { ProjectId } from '@study/contracts/ids';
import { queryOptions } from '@tanstack/react-query';

import { listPracticeMaterials } from '#web/lib/study-client/operations.ts';
import type { Subjects } from '#web/lib/study-client/operations.ts';

import { libraryItems } from './library.logic';

export function libraryQueryOptions(subjects: Subjects, project?: ProjectId, enabled = true) {
  const projectIds = project ? [project] : subjects.map((subject) => subject.id);

  projectIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return queryOptions({
    queryKey: ['library', 'practice', projectIds.map(String), project?.toString()],
    queryFn: async ({ signal }) =>
      libraryItems(await listPracticeMaterials(project, signal), project),
    enabled,
    refetchOnWindowFocus: 'always'
  });
}
