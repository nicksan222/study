import type { MaterialId, ProjectId, QuizAttemptId } from '@study/contracts/ids';
import { rpc } from '@study/contracts/react';

import { useCursorRecovery, useCursorWindow } from '#client/lib/cursor-window.tsx';

export function useAttempts(materialId: MaterialId, enabled: boolean) {
  const pagination = useCursorWindow<QuizAttemptId>(String(materialId));
  const query = rpc.learning.attempts.useQuery(
    { materialId, limit: pagination.limit, cursor: pagination.cursor },
    { enabled }
  );

  useCursorRecovery(pagination, query.error);

  return {
    ...query,
    pagination,
    hasNextPage: !!query.data?.nextCursor,
    isFetchingNextPage: query.isFetching,
    fetchNextPage: () => pagination.more(query.data?.nextCursor)
  };
}

export function useArchivedMaterials(projectId: ProjectId | undefined, enabled: boolean) {
  const pagination = useCursorWindow<MaterialId>(String(projectId ?? 'global'));
  const query = rpc.materials.list.useQuery(
    { projectId, archived: true, limit: pagination.limit, cursor: pagination.cursor },
    { enabled }
  );

  useCursorRecovery(pagination, query.error);

  return {
    ...query,
    pagination,
    hasNextPage: !!query.data?.nextCursor,
    isFetchingNextPage: query.isFetching,
    fetchNextPage: () => pagination.more(query.data?.nextCursor)
  };
}

export function useMaterialArchive(id: MaterialId, archived: boolean) {
  const archive = rpc.materials.archive.useMutation();
  const restore = rpc.materials.unarchive.useMutation();
  const mutation = archived ? restore : archive;

  return { ...mutation, mutate: () => mutation.mutate({ id }) };
}
