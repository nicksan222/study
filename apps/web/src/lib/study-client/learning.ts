import type { ProjectId } from '@study/contracts/ids';
import type { dueCardsInputSchema } from '@study/contracts/learning/rpc';
import { Effect } from 'effect';

import { collectPages } from './pagination';
import { request } from './request';

export const listDueCards = (projectId: ProjectId, signal?: AbortSignal) =>
  request(
    (rpc) =>
      collectPages((cursor: typeof dueCardsInputSchema.Type.cursor) =>
        rpc['learning.dueCards']({ projectId, cursor, limit: 100 }).pipe(
          Effect.map((page) => ({ items: page.items, next: page.nextCursor }))
        )
      ),
    signal
  );
