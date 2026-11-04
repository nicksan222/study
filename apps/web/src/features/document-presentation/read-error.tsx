import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';

import { useI18n } from '#web/lib/i18n.tsx';
import { toStudyError } from '#web/lib/study-client/errors.ts';

/** Exact content failures preserve their selected identity and offer an explicit retry. */
export function ContentReadError({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useI18n();
  return (
    <ErrorState
      title={t('ErrorStateTitle')}
      description={t(
        toStudyError(error).kind === 'not_found' ? 'ReaderUnavailable' : 'ReaderReadFailed'
      )}
      action={
        retry && (
          <Button size="sm" variant="outline" onClick={retry}>
            {t('Retry')}
          </Button>
        )
      }
    />
  );
}
