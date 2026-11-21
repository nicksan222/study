import type { Source } from '@study/contracts';
import { DocumentSourceIcon } from '@study/icons';
import { mediaSize } from '@study/localization';
import { SourceReader } from '@study/ui';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

export function FileAttachmentPreview({
  source,
  feedback
}: {
  source: Source;
  feedback: ReactNode;
}) {
  const { t, locale } = useI18n();

  return (
    <SourceReader.AttachmentPreview aria-label={t('MaterialPreview')}>
      <SourceReader.AttachmentPaper>
        <DocumentSourceIcon aria-hidden="true" />
        <SourceReader.AttachmentNotice>
          {t(`sourceKind.${source.kind}`)} · {mediaSize(locale, Number(source.sizeBytes))}
        </SourceReader.AttachmentNotice>
        {feedback}
      </SourceReader.AttachmentPaper>
    </SourceReader.AttachmentPreview>
  );
}
