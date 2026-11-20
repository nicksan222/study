import type { SourceId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Button, StatusMessage } from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';

import { useSourceProcessingExecution } from './source-panel.queries';

export function ProcessingRetry({ id }: { id: SourceId }) {
  const { t } = useI18n();
  const state = useSourceProcessingExecution(id);
  const retry = rpc.sources.requestProcessing.useMutation();
  const revision = state.revision;

  if (!revision || state.data?.outcome !== 'failure' || state.data.failureKind === 'unsupported')
    return null;

  return (
    <>
      <Button
        variant="ghost"
        disabled={retry.pending > 0}
        onClick={() => void retry.mutate({ id, expectedRevision: revision })}
      >
        {t('UploadedMaterialsRetry')}
      </Button>
      {retry.error && <StatusMessage>{t('UploadedMaterialsRetryFailed')}</StatusMessage>}
    </>
  );
}
