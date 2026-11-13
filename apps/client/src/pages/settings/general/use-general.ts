import { Language } from '@study/contracts/settings/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useLanguage } from '#client/lib/i18n.tsx';
import { appSettingsQueryOptions } from '#client/lib/study-client/preferences.queries.ts';

import { languageMutationOptions } from './general.queries';

export function useGeneralSettings() {
  const client = useQueryClient();
  const { setLocale } = useLanguage();
  const query = useQuery(appSettingsQueryOptions());
  const mutation = useMutation({
    ...languageMutationOptions(),
    onSuccess: async (settings) => {
      await client.cancelQueries({ queryKey: appSettingsQueryOptions().queryKey });
      client.setQueryData(appSettingsQueryOptions().queryKey, settings);
      setLocale(settings.language === Language.ITALIAN ? 'italian' : 'english');
      await client.invalidateQueries({ queryKey: ['appearance'] });
    }
  });

  return {
    data: query.data,
    loading: query.isPending,
    pending: mutation.isPending,
    error: query.isError || mutation.isError,
    retry: () => {
      mutation.reset();
      void query.refetch();
    },
    setLanguage: (value: string) => {
      if (value === 'english' || value === 'italian') {
        mutation.mutate(value === 'italian' ? Language.ITALIAN : Language.ENGLISH);
      }
    }
  };
}
