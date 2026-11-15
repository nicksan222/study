import type { ProjectId, MaterialId, NoteId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useEffect } from 'react';

import { useCursorRecovery, useCursorWindow } from '#client/lib/cursor-window.tsx';
import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import { useCollectionState } from './collection-state';

export function useCollectionsView() {
  const { t } = useI18n();
  const { state: draft, update, mutate } = useCollectionState();
  const window = useCursorWindow<ProjectId>('collections');
  const limit = window.limit;
  const list = rpc.projects.list.useQuery({ limit, before: window.cursor });

  useCursorRecovery(window, list.error);
  const selected = rpc.projects.get.useQuery(
    draft.selected === null ? undefined : { id: draft.selected }
  );

  useEffect(() => {
    if (selected.isError && toStudyError(selected.error).kind === 'not_found')
      update((value) => (value.accepted === draft.selected ? { ...value, accepted: null } : value));
  }, [selected.isError, selected.error, draft.selected, update]);

  return {
    t,
    draft,
    update,
    mutate,
    name: draft.name.text,
    busy: draft.pending,
    list,
    selected,
    window,
    loadMore: () => window.more(list.data?.next)
  };
}

export function materialMembership(projectId: ProjectId, materialId: MaterialId, add: boolean) {
  return add
    ? rpc.projects.addMaterial.call({ projectId, materialId })
    : rpc.projects.removeMaterial.call({ projectId, materialId });
}

export function noteMembership(projectId: ProjectId, noteId: NoteId, add: boolean) {
  return add
    ? rpc.projects.addNote.call({ projectId, noteId })
    : rpc.projects.removeNote.call({ projectId, noteId });
}
