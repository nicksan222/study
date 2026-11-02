import type { SessionId } from '@study/contracts/ids';
import { queryOptions, mutationOptions } from '@tanstack/react-query';

import { updateSelection } from './session-workspace.queries';
import type { Selection } from './session-workspace.queries';

export function selectionDraftOptions(id: SessionId) {
  return queryOptions({
    queryKey: ['session-drafts', String(id), 'selection'],
    queryFn: () => null as Selection | null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity
  });
}

export function saveSelectionOptions(id: SessionId) {
  return mutationOptions({
    mutationFn: (value: Selection) =>
      updateSelection({ sessionId: id, expectedRevision: value.revision, targets: value.targets })
  });
}
