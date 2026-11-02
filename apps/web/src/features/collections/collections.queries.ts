import type { ProjectId, MaterialId, SessionId } from '@study/contracts/ids';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { request } from '../../lib/study-client/request';
import { useCollectionState } from './collection-state';

export function useCollectionsView() {
  const { t } = useI18n();
  const client = useQueryClient();
  const { state: draft, update, mutate } = useCollectionState();
  const name = draft.name.text;
  const busy = draft.pending;
  const list = useInfiniteQuery({
    queryKey: ['projects', 'collections', 'pages'],
    initialPageParam: undefined as ProjectId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request((c) => c['projects.projects']({ limit: 20, before: pageParam }), signal),
    getNextPageParam: (page) => page.next ?? undefined
  });
  const selected = useQuery({
    queryKey: ['projects', 'collection', String(draft.selected)],
    enabled: draft.selected !== null,
    queryFn: ({ signal }) => request((c) => c['projects.project']({ id: draft.selected! }), signal)
  });

  useEffect(() => {
    if (selected.isError && toStudyError(selected.error).kind === 'not_found') {
      update((value) => (value.accepted === draft.selected ? { ...value, accepted: null } : value));
    }
  }, [selected.isError, selected.error, draft.selected, update]);

  return { t, client, draft, update, mutate, name, busy, list, selected };
}

export function materialMembership(projectId: ProjectId, materialId: MaterialId, add: boolean) {
  return request((client) =>
    add
      ? client['projects.addMaterial']({ projectId, materialId })
      : client['projects.removeMaterial']({ projectId, materialId })
  );
}

export function sessionMembership(projectId: ProjectId, sessionId: SessionId, add: boolean) {
  return request((client) =>
    add
      ? client['projects.addSession']({ projectId, sessionId })
      : client['projects.removeSession']({ projectId, sessionId })
  );
}
