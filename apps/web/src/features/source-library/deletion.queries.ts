import type { Source } from '@study/contracts/sources/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Option } from 'effect';
import { useState } from 'react';

import { request } from '#web/lib/study-client/request.ts';

export function useSourceDeletion(source: Source, onDeleted: () => void) {
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const key = ['sources', 'deletion-preview', String(source.id)];
  const preview = useQuery({
    queryKey: key,
    enabled: open,
    retry: false,
    queryFn: ({ signal }) =>
      request((rpc) => rpc['sources.previewDeletion']({ id: source.id }), signal)
  });
  const remove = useMutation({
    mutationKey: ['sources', 'delete', String(source.id)],
    retry: false,
    mutationFn: async () => {
      try {
        await request((rpc) => rpc['sources.deleteSource']({ id: source.id }));
      } catch (error) {
        // A lost response can be recovered through the source's durable absence.
        let absent = false;
        try {
          absent = Option.isNone(
            await request((rpc) => rpc['sources.findSource']({ id: source.id }))
          );
        } catch {
          /* Keep the original failure when availability cannot be checked. */
        }
        if (!absent) throw error;
      }
    },
    onSuccess: async () => {
      setOpen(false);
      onDeleted();
      const owned = {
        predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
          sourceBodyQuery(queryKey, String(source.id))
      };
      await cache.cancelQueries(owned);
      cache.removeQueries(owned);
      for (const queryKey of [
        ['sources', 'library'],
        ['sources', 'selection'],
        ['library'],
        ['search']
      ])
        void cache.invalidateQueries({ queryKey });
    },
    onError: () => {
      void cache.invalidateQueries({ queryKey: key });
    }
  });
  function show() {
    remove.reset();
    setOpen(true);
  }
  return { open, setOpen, show, preview, remove };
}

function sourceBodyQuery(query: readonly unknown[], id: string) {
  if (query[0] === 'source-copy') return query[1] === id;
  if (query[0] !== 'sources') return false;
  if (query[1] === 'image') return query[4] === id;
  if (query[1] === 'selected-input')
    return typeof query[2] === 'string' && query[2].startsWith(`source:${id}:`);
  return (
    ['detail', 'current-extraction', 'extraction', 'history', 'deletion-preview'].includes(
      String(query[1])
    ) && query[2] === id
  );
}
