import { rpc } from '@study/contracts/react';
import { useState } from 'react';

export function useSidebarSettings() {
  const query = rpc.settings.sidebarSettings.useQuery({});
  const [draft, setDraft] = useState<string>();
  const value = draft ?? String(query.data?.settledPageThreshold ?? '');
  const number = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(number) && number >= 1 && number <= 100;
  const mutation = rpc.settings.saveSidebarSettings.useMutation();

  return {
    query,
    mutation,
    value,
    valid,
    setDraft,
    changed: query.data && number !== query.data.settledPageThreshold,
    save: () => {
      if (valid && query.data && !mutation.isPending)
        void mutation
          .mutateAsync({ settledPageThreshold: number })
          .then(() => setDraft(undefined))
          .catch(() => {});
    }
  };
}
