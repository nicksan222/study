import type {
  sessionWorkItemSchema,
  sessionWorkPageSchema
} from '@study/contracts/conversations/work';
import type { SessionId } from '@study/contracts/ids';
import { infiniteQueryOptions, mutationOptions } from '@tanstack/react-query';

import { request } from '#web/lib/study-client/request.ts';

import { cancelGeneration } from './session-workspace.queries';

export type SessionWorkItem = typeof sessionWorkItemSchema.Type;

type Cursor = typeof sessionWorkPageSchema.Type.next;

export const sessionWorkKey = (id: SessionId) => ['session-work', String(id)];

export const sessionWorkOptions = (id: SessionId) =>
  infiniteQueryOptions({
    queryKey: sessionWorkKey(id),
    initialPageParam: null as Cursor,
    queryFn: ({ pageParam, signal }) =>
      request(
        (client) =>
          client['conversations.sessionWork']({
            sessionId: id,
            limit: 20,
            before: pageParam ?? undefined
          }),
        signal
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    refetchInterval: 3000
  });

export const stopSessionWorkOptions = () =>
  mutationOptions({
    mutationFn: async (item: SessionWorkItem): Promise<void> => {
      if (item.kind === 'transform') await cancelGeneration(item.requestId);
      else
        await request((client) =>
          client['workflows.cancelExecution']({ id: item.execution.id, mode: 'safe' })
        );
    },
    retry: false
  });
