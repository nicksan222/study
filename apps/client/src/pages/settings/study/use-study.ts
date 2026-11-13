import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { reviewSettingsMutationOptions, reviewSettingsQueryOptions } from './study.queries';

export function useStudySettings() {
  const client = useQueryClient();
  const query = useQuery(reviewSettingsQueryOptions());
  const [draftOverride, setDraft] = useState<string>();
  const draft = draftOverride ?? String(query.data?.newCardsPerDay ?? '');
  const mutation = useMutation({
    ...reviewSettingsMutationOptions(),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: reviewSettingsQueryOptions().queryKey });
      setDraft(undefined);
    },
    onError: () => setDraft(undefined)
  });

  const number = Number(draft);
  const valid = draft.trim() !== '' && Number.isInteger(number) && number >= 0 && number <= 10000;

  return {
    data: query.data,
    draft,
    setDraft,
    valid,
    changed: query.data !== undefined && number !== query.data.newCardsPerDay,
    loading: query.isPending,
    pending: mutation.isPending,
    error: query.isError || mutation.isError,
    retry: () => {
      mutation.reset();
      setDraft(undefined);
      void query.refetch();
    },
    save: () => {
      if (valid && !mutation.isPending) mutation.mutate({ newCardsPerDay: number });
    }
  };
}
