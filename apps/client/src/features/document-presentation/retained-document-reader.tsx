import type { ContentSnapshotId, documentSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Button, ErrorState, Loading, StructuredEditor } from '@study/ui';
import { useEffect, useMemo, useRef } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { documentToEditor } from './document-editor-content';
import { DocumentReader } from './document-reader';
import { useDocumentEditorImages } from './editor-images.queries';
import { useStructuredEditorLabels } from './structured-editor-labels';

type Document = typeof documentSchema.Type;
/** Canonical image references resolve retained original revisions through Sources. */

export function RetainedDocumentReader({
  document,
  snapshotId,
  showOmissions
}: {
  document: Document;
  snapshotId: ContentSnapshotId;
  showOmissions?: boolean;
}) {
  return (
    <DocumentReader
      document={document}
      showOmissions={showOmissions}
      renderImage={(block) =>
        block.content.type === 'image' ? (
          <RetainedImage
            key={`${snapshotId}:${block.id}`}
            snapshotId={snapshotId}
            blockId={block.id}
            image={block.content}
          />
        ) : null
      }
    />
  );
}

export function RetainedDocumentPreview({
  document,
  snapshotId
}: {
  document: Document;
  snapshotId: ContentSnapshotId;
}) {
  const { t } = useI18n();
  const preferences = useWorkspacePreferences();
  const labels = useStructuredEditorLabels();
  const images = useDocumentEditorImages(document, snapshotId);
  const value = useMemo(
    () => documentToEditor(document, images.urls, true),
    [document, images.urls]
  );

  return (
    <>
      {images.subscriptions}
      {images.error && (
        <ErrorState
          title={t('ReaderImageUnavailable')}
          action={<Button onClick={images.retry}>{t('ReaderRetryImage')}</Button>}
        />
      )}
      {document.blocks.length === 0 && <p>{t('ReaderNoText')}</p>}
      <StructuredEditor
        value={value}
        onChange={() => {}}
        readOnly
        fontSize={preferences.readerFontSize}
        label={t('NotePageEditor')}
        placeholder={t('NotePagePlaceholder')}
        labels={labels}
      />
    </>
  );
}

function RetainedImage({
  snapshotId,
  blockId,
  image
}: {
  snapshotId: ContentSnapshotId;
  blockId: string;
  image: Extract<Document['blocks'][number]['content'], { type: 'image' }>;
}) {
  const { t } = useI18n();
  const state = rpc.sources.exportRevision.useQuery({
    sourceId: image.sourceId,
    revision: BigInt(image.revision)
  });

  if (state.isPending || state.isFetching) return <Loading label={t('LoadingStudy')} />;

  if (state.isError)
    return (
      <ErrorState
        title={t('ReaderImageUnavailable')}
        action={<Button onClick={() => void state.refetch()}>{t('ReaderRetryImage')}</Button>}
      />
    );

  if (!state.data) return <Loading label={t('LoadingStudy')} />;

  return (
    <ResolvedImage
      key={`${snapshotId}:${blockId}`}
      bytes={state.data.bytes}
      mime={state.data.mime}
      image={image}
    />
  );
}

/** The resolved image owns its object URL through render changes and retry placeholders. */
function ResolvedImage({
  bytes,
  mime,
  image
}: {
  bytes: Uint8Array;
  mime: string;
  image: Extract<Document['blocks'][number]['content'], { type: 'image' }>;
}) {
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const next = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));

    const node = ref.current;

    if (node) node.src = next;

    return () => {
      node?.removeAttribute('src');
      URL.revokeObjectURL(next);
    };
  }, [bytes, mime]);

  return <img ref={ref} alt={image.alt} width={image.width} height={image.height} />;
}
