import type { SourceId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Button, StatusMessage } from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';

export function ProcessingRetry({ sourceId, revision }: { sourceId: SourceId; revision: number }) {
  const { t } = useI18n();
  const retry = rpc.sources.requestProcessing.useMutation();

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={retry.pending > 0}
        onClick={() => void retry.mutate({ id: sourceId, expectedRevision: revision })}
      >
        {t('UploadedMaterialsRetry')}
      </Button>
      {retry.error && <StatusMessage>{t('UploadedMaterialsRetryFailed')}</StatusMessage>}
    </>
  );
}
