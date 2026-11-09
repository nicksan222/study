import type { ContentSnapshotId } from '@study/contracts/ids';
import type { documentSchema } from '@study/contracts/sources/schemas';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { StructuredEditor } from '@study/ui/structured-editor';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { useWorkspacePreferences } from '#web/lib/study-client/workspace-preferences.queries.ts';

import { documentToEditor } from './document-editor-content';
import { DocumentOmissions, DocumentReader } from './document-reader';
import { useDocumentEditorImages } from './editor-images.queries';
import { retainedImageOptions } from './retained-document.queries';
import { useStructuredEditorLabels } from './structured-editor-labels';

type Document = typeof documentSchema.Type;
/** Canonical image references resolve retained original revisions through Sources. */

export function RetainedDocumentReader({
  document,
  snapshotId
}: {
  document: Document;
  snapshotId: ContentSnapshotId;
}) {
  return (
    <DocumentReader
      document={document}
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
      <DocumentOmissions document={document} />
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
  const ref = useRef<HTMLImageElement>(null);
  const state = useQuery(retainedImageOptions(snapshotId, blockId, image));

  useEffect(() => {
    const node = ref.current;
    const value = state.data;

    if (!node || !value || state.isError) return;

    const url = URL.createObjectURL(new Blob([new Uint8Array(value.bytes)], { type: value.mime }));

    node.src = url;

    return () => {
      node.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [state.data, state.isError]);

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  if (state.isError)
    return (
      <ErrorState
        title={t('ReaderImageUnavailable')}
        action={<Button onClick={() => void state.refetch()}>{t('ReaderRetryImage')}</Button>}
      />
    );

  return <img ref={ref} alt={image.alt} width={image.width} height={image.height} />;
}
