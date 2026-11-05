import type { ProjectId } from '@study/contracts/ids';
import { queryOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

export const subjectOptions = (project: ProjectId) =>
  queryOptions({
    queryKey: ['projects', 'collection', String(project)],
    queryFn: ({ signal }) =>
      request((client) => client['projects.project']({ id: project }), signal)
  });
