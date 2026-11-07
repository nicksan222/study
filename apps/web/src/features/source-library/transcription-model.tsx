import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { Settings } from '@study/ui/settings';

import { useI18n } from '#web/lib/i18n.tsx';

import { useTranscriptionModel } from './transcription.queries';

export function TranscriptionModelSetting() {
  const { t } = useI18n();
  const { query, install } = useTranscriptionModel();

  return (
    <>
      <Settings.Row title={t('LocalTranscriptionModel')} description={t('VozModelHelp')}>
        {query.data?.installed ? (
          t('ModelInstalled')
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={query.isPending || install.isPending}
            onClick={() => install.mutate()}
          >
            {t(install.isPending ? 'DownloadingModel' : 'DownloadModel')}
          </Button>
        )}
      </Settings.Row>
      {query.isPending && <Settings.Status>{t('LoadingSettings')}</Settings.Status>}
      {query.error && (
        <Settings.Status
          action={<RetryButton onClick={() => void query.refetch()} label={t('Retry')} />}
        >
          {t('TranscriptionLoadError')}
        </Settings.Status>
      )}
      {install.error && <Settings.Status>{t('ModelDownloadError')}</Settings.Status>}
    </>
  );
}
