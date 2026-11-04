import { selectionReferenceKey } from '@study/contracts/conversations/context';
import type { selectionReferenceSchema } from '@study/contracts/conversations/context';
import type { SessionId } from '@study/contracts/ids';
import { queryOptions, mutationOptions } from '@tanstack/react-query';

import { listSources } from '#web/lib/study-client/operations.ts';
import { selectedContent } from '#web/lib/study-client/selected-content.ts';

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

export function selectedContentOptions(input: typeof selectionReferenceSchema.Type) {
  return queryOptions({
    queryKey: [
      input.kind === 'document' ? 'documents' : 'sources',
      'selected-input',
      selectionReferenceKey(input)
    ],
    queryFn: ({ signal }) => selectedContent(input, signal)
  });
}

export const selectionSourcesOptions = () =>
  queryOptions({
    queryKey: ['sources', 'selection'],
    queryFn: ({ signal }) => listSources(signal)
  });
