import { rpc } from '@study/contracts/react';
import { useState } from 'react';

export function useStudySettings() {
  const query = rpc.settings.reviewSettings.useQuery({});
  const [draftOverride, setDraft] = useState<string>();
  const draft = draftOverride ?? String(query.data?.newCardsPerDay ?? '');
  const mutation = rpc.settings.saveReviewSettings.useMutation();

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
      if (valid && !mutation.isPending)
        void mutation
          .mutateAsync({ newCardsPerDay: number })
          .then(() => setDraft(undefined))
          .catch(() => {});
    }
  };
}
