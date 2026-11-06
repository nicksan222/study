import { RetryButton } from '@study/ui/action-button';
import { ErrorState } from '@study/ui/error-state';
import { useRouter } from '@tanstack/react-router';

import { useI18n } from '#web/lib/i18n.tsx';

export function RoutePending() {
  return null;
}

export function RouteError() {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <ErrorState
      layout="page"
      title={t('PageErrorTitle')}
      description={t('StudyLoadError')}
      action={
        <RetryButton
          variant="outline"
          onClick={() => void router.invalidate()}
          label={t('Retry')}
        />
      }
    />
  );
}
