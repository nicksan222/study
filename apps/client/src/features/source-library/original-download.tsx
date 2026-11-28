import type { SourceId } from '@study/contracts';
import { DownloadIcon } from '@study/icons';
import { Button, ErrorState, IconButton, RetryButton } from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';

import { useSourceExport } from './source-export.queries';

export function OriginalDownload({
  sourceId,
  revision,
  withLabel
}: {
  sourceId: SourceId;
  revision?: bigint;
  withLabel?: boolean;
}) {
  const { t } = useI18n();
  const download = useSourceExport(sourceId, revision);
  const action = { disabled: download.pending > 0, onClick: () => void download.mutate(undefined) };

  return (
    <>
      {withLabel ? (
        <Button variant="outline" size="sm" {...action}>
          <DownloadIcon aria-hidden="true" />
          {t('ReaderOriginal')}
        </Button>
      ) : (
        <IconButton size="icon-sm" label={t('ReaderOriginal')} {...action}>
          <DownloadIcon aria-hidden="true" />
        </IconButton>
      )}
      {download.error && (
        <ErrorState
          title={t('ReaderOriginalUnavailable')}
          action={<RetryButton label={t('Retry')} onClick={action.onClick} />}
        />
      )}
    </>
  );
}
