import type { ProjectId, StudyDocumentId } from '@study/contracts/ids';
import { Effect } from 'effect';

import { collectPages } from './pagination';
import { request } from './request';

export const listPracticeDocuments = (projectId?: ProjectId, signal?: AbortSignal) =>
  request(
    (rpc) =>
      collectPages((cursor: StudyDocumentId | undefined) =>
        rpc['documents.documents']({ projectId, cursor, limit: 100, archived: false }).pipe(
          Effect.map((page) => ({ items: page.items, next: page.nextCursor }))
        )
      ).pipe(Effect.map((items) => items.filter((item) => item.headVersionId !== null))),
    signal
  );
