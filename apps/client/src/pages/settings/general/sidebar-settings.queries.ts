import { rpc } from '@study/contracts/react';
import { useState } from 'react';

import {
  useSettingsAutosave,
  validSettingsNumber,
  isPersistedNumberDraft
} from '#client/lib/settings-autosave.ts';

export function useSidebarSettings() {
  const query = rpc.settings.sidebarSettings.useQuery({});
  const [draft, setDraft] = useState<string>();
  const value = draft ?? String(query.data?.settledPageThreshold ?? '');
  const valid = validSettingsNumber(value, 1, 100);
  const mutation = rpc.settings.saveSidebarSettings.useMutation();

  const autosave = useSettingsAutosave(
    () => rpc.settings.sidebarSettings.read({}),
    mutation.mutateAsync
  );

  if (
    !autosave.pending &&
    !autosave.error &&
    isPersistedNumberDraft(draft, query.data?.settledPageThreshold)
  )
    setDraft(undefined);

  return {
    query,
    mutation: {
      ...mutation,
      isPending: autosave.pending,
      error: autosave.error,
      reset: autosave.retry
    },
    value,
    valid,
    setDraft: (value: string) => {
      setDraft(value);

      if (query.data && validSettingsNumber(value, 1, 100))
        autosave.update({ settledPageThreshold: Number(value) });
    }
  };
}
