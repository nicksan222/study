import type { executionSchema, executionsPageSchema } from '@study/contracts/workflows/schemas';
import { infiniteQueryOptions, queryOptions, mutationOptions } from '@tanstack/react-query';

import { request } from '../../lib/study-client/request';

type Execution = typeof executionSchema.Type;

type Cursor = typeof executionsPageSchema.Type.next;

export const activityPagesOptions = () =>
  infiniteQueryOptions({
    queryKey: ['activity', 'pages'],
    initialPageParam: null as Cursor,
    queryFn: ({ pageParam, signal }) =>
      request(
        (c) => c['workflows.executions']({ limit: 20, before: pageParam ?? undefined }),
        signal
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    refetchInterval: 5000
  });

export const activityExecutionOptions = (selected?: Execution['id']) =>
  queryOptions({
    queryKey: ['activity', selected],
    enabled: selected !== undefined,
    queryFn: ({ signal }) => request((c) => c['workflows.execution']({ id: selected! }), signal),
    refetchInterval: 5000
  });

export const cancelExecutionOptions = () =>
  mutationOptions({
    mutationFn: (id: Execution['id']) =>
      request((c) => c['workflows.cancelExecution']({ id, mode: 'safe' }))
  });
