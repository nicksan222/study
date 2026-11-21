import type { Source, SourcePreview } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Loading, StatusMessage } from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';

import { ContentReadError } from '../document-presentation';
import { CsvSourcePreview } from './csv-source-preview';
import { FileAttachmentPreview } from './file-attachment-preview';

export function DataAttachmentPreview({ source }: { source: Source }) {
  const { t } = useI18n();
  const state = rpc.sources.preview.useQuery({ id: source.id });

  if (state.error)
    return <ContentReadError error={state.error} retry={() => void state.refetch()} />;

  if (!state.data) return <Loading label={t('LoadingStudy')} />;

  return <DataPreviewBody source={source} preview={state.data} />;
}

function DataPreviewBody({ source, preview }: { source: Source; preview: SourcePreview }) {
  const { t } = useI18n();

  switch (preview.kind) {
    case 'table':
      return <CsvSourcePreview preview={preview} />;
    case 'unavailable': {
      const label = {
        size: 'MaterialDataTooLarge',
        invalid: 'MaterialDataInvalid',
        unsupported: 'UploadedMaterialsPreviewUnavailable'
      } as const;

      return (
        <FileAttachmentPreview
          source={source}
          feedback={<StatusMessage>{t(label[preview.reason])}</StatusMessage>}
        />
      );
    }
  }
}
