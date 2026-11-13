import type { ProjectId, PageId } from '@study/contracts/ids';
import { Effect } from 'effect';

import { collectPages } from './pagination';
import { request } from './request';

export const listPracticePages = (projectId?: ProjectId, signal?: AbortSignal) =>
  request(
    (rpc) =>
      collectPages((cursor: PageId | undefined) =>
        rpc['pages.pages']({ projectId, cursor, limit: 100, archived: false }).pipe(
          Effect.map((page) => ({ items: page.items, next: page.nextCursor }))
        )
      ).pipe(Effect.map((items) => items.filter((item) => item.headVersionId !== null))),
    signal
  );
