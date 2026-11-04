import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { request } from '#web/lib/study-client/request.ts';
import { sidebarSettingsOptions } from '#web/lib/study-client/sidebar.queries.ts';

/** Validates and saves the threshold, preserving failed input for retry. */
export function useSidebarSettings() {
  const cache = useQueryClient();
  const query = useQuery(sidebarSettingsOptions());
  const [draft, setDraft] = useState<string>();
  const value = draft ?? String(query.data?.settledDocumentThreshold ?? '');
  const number = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(number) && number >= 1 && number <= 100;
  const mutation = useMutation({
    mutationFn: () =>
      request((rpc) => rpc['settings.saveSidebarSettings']({ settledDocumentThreshold: number })),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: sidebarSettingsOptions().queryKey });
      setDraft(undefined);
    }
  });

  return {
    query,
    mutation,
    value,
    valid,
    setDraft,
    changed: query.data && number !== query.data.settledDocumentThreshold,
    save: () => {
      if (valid && query.data && !mutation.isPending) mutation.mutate();
    }
  };
}
