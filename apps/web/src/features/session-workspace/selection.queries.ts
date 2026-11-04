import { selectionReferenceKey } from '@study/contracts/conversations/context';
import type { selectionReferenceSchema } from '@study/contracts/conversations/context';
import { StudyError } from '@study/contracts/errors';
import type { ContentSnapshotId, StudyDocumentId } from '@study/contracts/ids';
import type { SessionId } from '@study/contracts/ids';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { queryOptions, mutationOptions } from '@tanstack/react-query';
import { Effect } from 'effect';

import { listSources } from '#web/lib/study-client/operations.ts';
import { request } from '#web/lib/study-client/request.ts';

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

type SelectedContent = {
  snapshotId: ContentSnapshotId;
  documentId: StudyDocumentId | null;
  name: string;
  number?: bigint;
  document: typeof documentSchema.Type;
};
const present = (value: SelectedContent): SelectedContent => value;

export function selectedContentOptions(input: typeof selectionReferenceSchema.Type) {
  return queryOptions({
    queryKey: [
      input.kind === 'document' ? 'documents' : 'sources',
      'selected-input',
      selectionReferenceKey(input)
    ],
    queryFn: ({ signal }) =>
      request(
        (rpc) =>
          input.kind === 'source'
            ? rpc['sources.extraction'](input).pipe(
                Effect.map((value) => {
                  if (
                    value.sourceId !== input.sourceId ||
                    value.revision !== input.revision ||
                    value.snapshotId !== input.snapshotId
                  )
                    throw new StudyError('invalid_input', 'Source extraction identity mismatch');
                  return present({ ...value, documentId: null });
                })
              )
            : Effect.gen(function* () {
                const version = yield* rpc['documents.version']({ id: input.versionId });
                const owner = yield* rpc['documents.document']({ id: version.documentId });
                if (
                  version.status !== 'published' ||
                  version.id !== input.versionId ||
                  owner.id !== version.documentId
                )
                  throw new StudyError('invalid_input', 'Authored version ownership mismatch');
                return present({ ...version, name: owner.title });
              }),
        signal
      )
  });
}
export const selectionSourcesOptions = () =>
  queryOptions({
    queryKey: ['sources', 'selection'],
    queryFn: ({ signal }) => listSources(signal)
  });
