import type { exactExtractionSchema, Source } from '@study/contracts';
import { DocumentSourceIcon } from '@study/icons';
import { mediaSize } from '@study/localization';
import { SourceReader, StatusMessage } from '@study/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { RetainedDocumentReader } from '../document-presentation';

type Extraction = typeof exactExtractionSchema.Type;

type AttachmentContents = Pick<Extraction, 'document' | 'snapshotId'>;

export function StructuredAttachmentPreview({
  source,
  extraction,
  feedback
}: {
  source: Source;
  extraction?: Extraction | null;
  feedback: ReactNode;
}) {
  if (!extraction) return <FileAttachmentPreview source={source} feedback={feedback} />;

  return (
    <StructuredAttachmentContent
      key={String(extraction.snapshotId)}
      slides={source.kind === 'slides'}
      extraction={extraction}
    />
  );
}

function StructuredAttachmentContent({
  slides,
  extraction
}: {
  slides: boolean;
  extraction: Extraction;
}) {
  const { t } = useI18n();

  return (
    <SourceReader.AttachmentPreview aria-label={t('MaterialPreview')}>
      <SourceReader.AttachmentNotice>
        {t('MaterialPreviewSimplified')}
      </SourceReader.AttachmentNotice>
      {slides ? (
        <SlidePreview {...extraction} />
      ) : (
        <SourceReader.AttachmentPaper>
          <RetainedDocumentReader {...extraction} showOmissions={false} />
        </SourceReader.AttachmentPaper>
      )}
    </SourceReader.AttachmentPreview>
  );
}

function SlidePreview({ document, snapshotId }: AttachmentContents) {
  const { t, number } = useI18n();
  const [page, setPage] = useState(1);
  const total = Math.max(1, document.meta.pageCount ?? 0);
  const blocks = document.blocks.filter(
    (block) => block.anchor.type === 'slide' && block.anchor.index === page
  );

  return (
    <>
      <SourceReader.PdfControls>
        <SourceReader.PageStepper
          label={t('MaterialSlideNavigation')}
          previousLabel={t('MaterialPreviousSlide')}
          nextLabel={t('MaterialNextSlide')}
          position={t('MaterialSlidePosition', { page: number(page), total: number(total) })}
          page={page}
          total={total}
          onPageChange={setPage}
        />
      </SourceReader.PdfControls>
      <SourceReader.AttachmentPaper data-slide>
        {blocks.length ? (
          <RetainedDocumentReader
            document={{ ...document, blocks }}
            snapshotId={snapshotId}
            showOmissions={false}
          />
        ) : (
          <StatusMessage>{t('MaterialSlideEmpty')}</StatusMessage>
        )}
      </SourceReader.AttachmentPaper>
    </>
  );
}

export function FileAttachmentPreview({
  source,
  feedback
}: {
  source: Source;
  feedback?: ReactNode;
}) {
  const { t, locale } = useI18n();

  return (
    <SourceReader.AttachmentPreview aria-label={t('MaterialPreview')}>
      <SourceReader.AttachmentPaper>
        <DocumentSourceIcon aria-hidden="true" />
        <SourceReader.AttachmentNotice>
          {t(`sourceKind.${source.kind}`)} · {mediaSize(locale, Number(source.sizeBytes))}
        </SourceReader.AttachmentNotice>
        {feedback ?? <StatusMessage>{t('UploadedMaterialsPreviewUnavailable')}</StatusMessage>}
      </SourceReader.AttachmentPaper>
    </SourceReader.AttachmentPreview>
  );
}
