import type { ProjectId } from '@study/contracts/ids';
import { queryOptions } from '@tanstack/react-query';

import { listDocuments } from '#web/lib/study-client/documents.queries.ts';
import { listMaterialsForProjects } from '#web/lib/study-client/operations.ts';
import type { Subjects } from '#web/lib/study-client/operations.ts';
import { sourceLibraryOptions } from '#web/lib/study-client/sources.queries.ts';

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
    queryFn: async ({ signal, client }) => {
      const [sources, materials, documents] = await Promise.all([
        section === 'library'
          ? client.ensureQueryData(sourceLibraryOptions(project))
          : Promise.resolve([]),
        listMaterialsForProjects(projectIds, signal),
        section === 'library' ? listDocuments(project, signal) : Promise.resolve([])
      ]);

      return libraryItems(section, sources, materials, project, documents);
    },
    enabled,
    refetchOnWindowFocus: 'always'
  });
}
