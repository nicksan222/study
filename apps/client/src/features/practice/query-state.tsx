import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

export function PracticeQueryState({
  state,
  children
}: {
  state: { isPending: boolean; isError: boolean; refetch: () => unknown };
  children: ReactNode;
}) {
  const { t } = useI18n();

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  if (state.isError)
    return (
      <ErrorState
        title={t('PracticeLoadError')}
        action={<Button onClick={() => void state.refetch()}>{t('LibraryRefresh')}</Button>}
      />
    );

  return children;
}
