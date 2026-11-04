import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Link } from '@tanstack/react-router';

import { useI18n } from '#web/lib/i18n.tsx';

export function MaterialRouteError() {
  const { t } = useI18n();

  return (
    <ErrorState
      layout="page"
      title={t('ErrorStateTitle')}
      description={
        <>
          <p>{t('ReaderUnavailable')}</p>
          <Button render={<Link to="/library" search={{}} />}>{t('ReaderBack')}</Button>
        </>
      }
    />
  );
}
