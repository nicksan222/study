import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';

import { useI18n } from '../../lib/i18n';

export function SaveRecoveryNotice({
  conflict,
  onAccept,
  onRetry
}: {
  conflict: boolean;
  onAccept: () => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();

  return (
    <ErrorState
      layout="inline"
      title={t(conflict ? 'SessionAutosaveConflict' : 'SessionAutosaveFailed')}
      action={
        <Button size="sm" variant="outline" onClick={conflict ? onAccept : onRetry}>
          {t(conflict ? 'SessionUseSavedPage' : 'SessionRetrySave')}
        </Button>
      }
    />
  );
}
