import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { useRouter } from '@tanstack/react-router';

import { useI18n } from '../../lib/i18n';

export function RoutePending() {
  const { t } = useI18n();

  return <Loading layout="panel" label={t('LoadingStudy')} />;
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
        <Button variant="outline" onClick={() => void router.invalidate()}>
          {t('Retry')}
        </Button>
      }
    />
  );
}
