import type { sourceCopySchema } from '@study/contracts/documents/rpc';
import type { StudyDocument } from '@study/contracts/documents/types';
import type { SourceId, SessionId, ContentSnapshotId } from '@study/contracts/ids';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';

import { invalidateDocuments } from '#web/lib/study-client/documents.queries.ts';
import { request } from '#web/lib/study-client/request.ts';

/** A current pending revision never borrows a previous revision's extraction. */
export const sourceExtractionOptions = (
  id: SourceId,
  exact?: { revision: bigint; snapshotId: ContentSnapshotId }
) =>
  queryOptions({
    queryKey: exact
      ? ['sources', 'extraction', String(id), String(exact.revision), String(exact.snapshotId)]
      : ['sources', 'current-extraction', String(id)],
    queryFn: ({ signal }) =>
      request(
        (rpc) =>
          exact
            ? rpc['sources.extraction']({
                sourceId: id,
                revision: exact.revision,
                snapshotId: exact.snapshotId
              })
            : rpc['sources.currentExtraction']({ id }),
        signal
      ),
    refetchInterval: (query) => (query.state.data ? false : 3000)
  });
export const sourceOptions = (id: SourceId | null) =>
  queryOptions({
    queryKey: ['sources', 'detail', String(id)],
    enabled: id !== null,
    queryFn: ({ signal }) => request((rpc) => rpc['sources.source']({ id: id! }), signal),
    retry: false,
    staleTime: 30_000
  });

type Input = typeof sourceCopySchema.Type;
type CopyState = { pending: boolean; input?: Input; document?: StudyDocument; error?: unknown };

/** The query cache retains an immutable copy request until its uncertain receipt is recovered. */
export function useSourceCopy(sourceId: SourceId, sessionId?: SessionId) {
  const cache = useQueryClient();
  const key = ['source-copy', String(sourceId), sessionId?.toString()];
  const initial: CopyState = { pending: false };
  const state = useQuery({
    queryKey: key,
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
    gcTime: Infinity
  });
  async function copy(extraction: {
    revision: bigint;
    snapshotId: Input['snapshotId'];
    name: string;
  }) {
    const current = cache.getQueryData<CopyState>(key) ?? initial;
    if (current.pending) return undefined;
    if (current.document) return current.document;
    const input = current.input ?? {
      sourceId,
      sessionId,
      createKey: crypto.randomUUID(),
      title: extraction.name,
      revision: extraction.revision,
      snapshotId: extraction.snapshotId
    };
    cache.setQueryData<CopyState>(key, { pending: true, input });
    try {
      const document = await request((rpc) => rpc['documents.copySource'](input));
      cache.setQueryData<CopyState>(key, { pending: false, input, document });
      void invalidateDocuments(cache);
      return document;
    } catch (error) {
      cache.setQueryData<CopyState>(key, { pending: false, input, error });
      return undefined;
    }
  }
  function acknowledge() {
    const current = cache.getQueryData<CopyState>(key);
    if (current?.document && !current.pending) cache.setQueryData<CopyState>(key, initial);
  }
  return { ...state.data, copy, acknowledge };
}
