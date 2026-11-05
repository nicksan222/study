import type { ProjectId } from '@study/contracts/ids';
import { queryOptions } from '@tanstack/react-query';

import { listSubjectSources } from '#web/lib/study-client/navigation.ts';
import { request } from '#web/lib/study-client/request.ts';

/** The source catalog has a global cursor; filter canonical ownership after all pages resolve. */
export const subjectSourcesOptions = (project: ProjectId) =>
  queryOptions({
    queryKey: ['sources', 'subject', String(project)],
    queryFn: ({ signal }) => request((client) => listSubjectSources(client, project), signal)
  });
