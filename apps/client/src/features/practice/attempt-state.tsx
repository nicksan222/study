import type { MaterialId, quizAttemptSchema } from '@study/contracts';
import type { rpc } from '@study/contracts/react';
import { Button, ErrorState, Loading } from '@study/ui';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

type Attempt = typeof quizAttemptSchema.Type;

export function AttemptState({
  state,
  material,
  children
}: {
  state: ReturnType<typeof rpc.learning.attempt.useQuery>;
  material: MaterialId;
  children: (attempt: Attempt) => ReactNode;
}) {
  const { t } = useI18n();

  if (state.isPending) return <Loading label={t('LoadingPractice')} />;

  if (state.isError || !state.data || state.data.materialId !== material)
    return (
      <ErrorState
        title={t('ReaderUnavailable')}
        action={<Button onClick={() => void state.refetch()}>{t('LibraryRefresh')}</Button>}
      />
    );

  return children(state.data);
}
