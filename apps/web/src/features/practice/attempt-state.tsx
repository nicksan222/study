import type { MaterialId } from '@study/contracts/ids';
import type { quizAttemptSchema } from '@study/contracts/learning/schemas';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

type Attempt = typeof quizAttemptSchema.Type;

export function AttemptState({
  state,
  material,
  children
}: {
  state: UseQueryResult<Attempt>;
  material: MaterialId;
  children: (attempt: Attempt) => ReactNode;
}) {
  const { t } = useI18n();

  if (state.isPending) return <Loading label={t('LoadingPractice')} />;

  if (state.isError || state.data.materialId !== material)
    return (
      <ErrorState
        title={t('ReaderUnavailable')}
        action={<Button onClick={() => void state.refetch()}>{t('LibraryRefresh')}</Button>}
      />
    );

  return children(state.data);
}
