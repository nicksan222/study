import type { ProjectId, SourceId } from '@study/contracts/ids';
import { queryOptions } from '@tanstack/react-query';
import { Effect } from 'effect';

import { collectPages } from '#web/lib/study-client/pagination.ts';
import { request } from '#web/lib/study-client/request.ts';

/** The source catalog has a global cursor; filter canonical ownership after all pages resolve. */
export const subjectSourcesOptions = (project: ProjectId) =>
  queryOptions({
    queryKey: ['sources', 'subject', String(project)],
    queryFn: ({ signal }) =>
      request(
        (client) =>
          collectPages((before: SourceId | undefined) =>
            client['sources.sources']({ limit: 100, before })
          ).pipe(Effect.map((sources) => sources.filter((source) => source.projectId === project))),
        signal
      )
  });
