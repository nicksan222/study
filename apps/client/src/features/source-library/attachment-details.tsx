import type { Source, exactExtractionSchema } from '@study/contracts';
import { mediaSize, secondsTaken } from '@study/localization';
import { SourceReader } from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';

import { DocumentOmissions } from '../document-presentation';
import type { ExtractionJob } from './extraction-job';
import { ExtractionDetails } from './extraction-job-view';

function AttachmentFormat({ source }: { source: Source }) {
  const { t } = useI18n();
  const extension = source.name.match(/\.([a-z0-9]{1,12})$/i)?.[1]?.toUpperCase();
  const category = t(`sourceKind.${source.kind}`);
  const format =
    extension && extension !== category.toUpperCase() ? `${category} · ${extension}` : category;

  return <SourceReader.Detail label={t('UploadedMaterialsFormat')} value={format} />;
}

export function AttachmentDetails({
  source,
  extraction,
  job
}: {
  source: Source;
  job?: ExtractionJob;
  extraction?: typeof exactExtractionSchema.Type | null;
}) {
  const { t, date, locale, number } = useI18n();
  const meta = extraction?.document.meta;

  return (
    <>
      <SourceReader.Details
        heading={t('MaterialFileInformation')}
        notes={
          extraction?.document.meta.omissions.length ? (
            <DocumentOmissions document={extraction.document} />
          ) : undefined
        }
      >
        <AttachmentFormat source={source} />
        <SourceReader.Detail
          label={t('UploadedMaterialsSize')}
          value={mediaSize(locale, Number(source.sizeBytes))}
        />
        <SourceReader.Detail label={t('UploadedMaterialsAdded')} value={date(source.createdAt)} />
        {meta?.pageCount != null && meta.pageCount > 0 && (
          <SourceReader.Detail
            label={t(source.kind === 'slides' ? 'sourceKind.slides' : 'MaterialPageCount')}
            value={number(meta.pageCount)}
          />
        )}
        {meta?.durationMs != null && (
          <SourceReader.Detail
            label={t('MaterialMediaDuration')}
            value={secondsTaken(locale, meta.durationMs / 1000)}
          />
        )}
      </SourceReader.Details>
      {job && <ExtractionDetails sourceId={source.id} job={job} />}
    </>
  );
}
