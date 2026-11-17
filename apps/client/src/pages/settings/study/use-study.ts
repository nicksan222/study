import { rpc } from '@study/contracts/react';
import { useState } from 'react';

import {
  useSettingsAutosave,
  validSettingsNumber,
  isPersistedNumberDraft
} from '#client/lib/settings-autosave.ts';

export function useStudySettings() {
  const query = rpc.settings.reviewSettings.useQuery({});
  const [draftOverride, setDraft] = useState<string>();
  const draft = draftOverride ?? String(query.data?.newCardsPerDay ?? '');
  const mutation = rpc.settings.saveReviewSettings.useMutation();

  const autosave = useSettingsAutosave(
    () => rpc.settings.reviewSettings.read({}),
    mutation.mutateAsync
  );

  const valid = validSettingsNumber(draft, 0, 10000);

  if (
    !autosave.pending &&
    !autosave.error &&
    isPersistedNumberDraft(draftOverride, query.data?.newCardsPerDay)
  )
    setDraft(undefined);

  return {
    data: query.data,
    draft,
    setDraft: (value: string) => {
      setDraft(value);
      const next = Number(value);

      if (validSettingsNumber(value, 0, 10000)) autosave.update({ newCardsPerDay: next });
    },
    valid,
    loading: query.isPending,
    pending: autosave.pending,
    error: query.isError || autosave.error,
    retry: () => {
      autosave.retry();
      void query.refetch();
    }
  };
}
