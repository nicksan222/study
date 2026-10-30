import { Button } from '@study/ui/button';
import { Sidebar } from '@study/ui/sidebar';
import { useRouter } from '@tanstack/react-router';

import { useI18n } from '../../lib/i18n';

export function RoutePending() {
  const { t } = useI18n();

  return <Sidebar.Message role="status">{t('LoadingStudy')}</Sidebar.Message>;
}

export function RouteError() {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <Button
      variant="ghost-muted"
      onClick={() => {
        void router.invalidate();
      }}
    >
      {t('StudyLoadError')}
    </Button>
  );
}
