import type { SourceId, NoteId, ContentSnapshotId } from '@study/contracts/ids';
import type { sourceCopySchema } from '@study/contracts/pages/rpc';
import type { Page } from '@study/contracts/pages/types';
import type { executionCursorSchema } from '@study/contracts/workflows/schemas';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';

import { invalidatePages } from '#web/lib/study-client/pages.queries.ts';
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

/** Missing extraction is pending only while its own workflow has no reported outcome. */
export const sourceProcessingExecutionOptions = (id: SourceId) =>
  queryOptions({
    queryKey: ['sources', 'processing-execution', String(id)],
    queryFn: async ({ signal }) => {
      const processing = await request((rpc) => rpc['sources.sourceProcessing']({ id }), signal);

      if (!processing.requestId) return null;

      let before: typeof executionCursorSchema.Type | undefined;

      do {
        const executions = await request(
          (rpc) =>
            rpc['workflows.executions']({
              correlationId: processing.requestId!,
              limit: 100,
              before
            }),
          signal
        );

        const extraction = executions.items.find(
          (item) =>
            item.workflow === 'source-ingestion/v1' || item.workflow === 'source-correction/v1'
        );

        if (extraction) return extraction;

        before = executions.next ?? undefined;
      } while (before);

      return null;
    },
    refetchInterval: 3000
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

type CopyState = { pending: boolean; input?: Input; page?: Page; error?: unknown };

/** The query cache retains an immutable copy request until its uncertain receipt is recovered. */

export function useSourceCopy(sourceId: SourceId, noteId?: NoteId) {
  const cache = useQueryClient();

  const key = ['source-copy', String(sourceId), noteId?.toString()];

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

    if (current.page) return current.page;

    const input = current.input ?? {
      sourceId,
      noteId,
      createKey: crypto.randomUUID(),
      title: extraction.name,
      revision: extraction.revision,
      snapshotId: extraction.snapshotId
    };

    cache.setQueryData<CopyState>(key, { pending: true, input });

    try {
      const page = await request((rpc) => rpc['pages.copySource'](input));

      cache.setQueryData<CopyState>(key, { pending: false, input, page });
      void invalidatePages(cache);

      return page;
    } catch (error) {
      cache.setQueryData<CopyState>(key, { pending: false, input, error });

      return undefined;
    }
  }

  function acknowledge() {
    const current = cache.getQueryData<CopyState>(key);

    if (current?.page && !current.pending) cache.setQueryData<CopyState>(key, initial);
  }

  return { ...state.data, copy, acknowledge };
}
