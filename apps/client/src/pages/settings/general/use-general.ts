import { Language } from '@study/contracts';
import { rpc } from '@study/contracts/react';

import { useLanguage } from '#client/lib/i18n.tsx';

import { useAppSettingsPatch } from './app-settings';

export function useGeneralSettings() {
  const { setLocale } = useLanguage();
  const query = rpc.settings.appSettings.useQuery({});
  const mutation = useAppSettingsPatch();

  return {
    data: query.data,
    loading: query.isPending,
    pending: mutation.isPending,
    error: query.isError || mutation.isError || query.stale,
    retry: () => {
      mutation.reset();
      void query.refetch();
    },
    setLanguage: (value: string) => {
      if (!query.data || (value !== 'english' && value !== 'italian')) return;

      const language = value === 'italian' ? Language.ITALIAN : Language.ENGLISH;

      void mutation
        .mutateAsync({ language })
        .then(() => setLocale(value))
        .catch(() => {});
    }
  };
}
