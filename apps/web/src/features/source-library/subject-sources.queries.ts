import type { ProjectId } from '@study/contracts/ids';
import { queryOptions } from '@tanstack/react-query';

import { listSubjectSources } from '#web/lib/study-client/operations.ts';

/** The source catalog has a global cursor; filter canonical ownership after all pages resolve. */
export const subjectSourcesOptions = (project: ProjectId) =>
  queryOptions({
    queryKey: ['sources', 'subject', String(project)],
    queryFn: ({ signal }) => listSubjectSources(project, signal)
  });
