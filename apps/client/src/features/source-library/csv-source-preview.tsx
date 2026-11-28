import type { SourcePreview } from '@study/contracts';
import { DelimitedGrid, Loading, SourceReader, StatusMessage } from '@study/ui';
import { Suspense } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

export function CsvSourcePreview({
  preview
}: {
  preview: Extract<SourcePreview, { kind: 'table' }>;
}) {
  const { t } = useI18n();

  return (
    <SourceReader.AttachmentPreview aria-label={t('MaterialPreview')}>
      {preview.rows.length ? (
        <Suspense fallback={<Loading label={t('LoadingStudy')} />}>
          <DelimitedGrid
            columns={preview.columns}
            rows={preview.rows}
            rowLabel={t('MaterialDataRow')}
          />
        </Suspense>
      ) : (
        <StatusMessage>{t('MaterialDataTableEmpty')}</StatusMessage>
      )}
      {preview.limited && <StatusMessage>{t('MaterialDataTableLimited')}</StatusMessage>}
    </SourceReader.AttachmentPreview>
  );
}
