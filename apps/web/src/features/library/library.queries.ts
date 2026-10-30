import type { ProjectId } from '@study/contracts/ids';
import { queryOptions } from '@tanstack/react-query';

import { listMaterialsForProjects, listSources } from '../../lib/study-client/operations';
import type { Subjects } from '../../lib/study-client/operations';
import { libraryItems } from './library.logic';

export function libraryQueryOptions(
  section: 'library' | 'practice',
  subjects: Subjects,
  project?: ProjectId,
  enabled = true
) {
  const projectIds = project ? [project] : subjects.map((subject) => subject.id);

  projectIds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  return queryOptions({
    queryKey: ['library', section, projectIds.map(String), project?.toString()],
    queryFn: async ({ signal }) => {
      const [sources, materials] = await Promise.all([
        section === 'library' ? listSources(signal) : Promise.resolve([]),
        listMaterialsForProjects(projectIds, signal)
      ]);

      return libraryItems(section, sources, materials, project);
    },
    enabled,
    refetchOnWindowFocus: 'always'
  });
}
