import { useQuery } from '@tanstack/react-query';

import { useI18n } from '#web/lib/i18n.tsx';

import { request } from './request';

/** Shares localized conversion capability discovery across settings and chat controls. */
export function useConversionStrategies() {
  const { locale } = useI18n();

  return useQuery({
    queryKey: ['conversion-strategies', locale],
    queryFn: ({ signal }) => request((rpc) => rpc['sources.conversionStrategies']({}), signal),
    staleTime: 30_000,
    retry: false
  });
}
