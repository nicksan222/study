import type { ContentSnapshotId, documentSchema } from '@study/contracts';
import { Button, ErrorState, StructuredEditor } from '@study/ui';
import { useMemo } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { documentToEditor } from './document-editor-content';
import { useDocumentEditorImages } from './editor-images.queries';
import { useStructuredEditorLabels } from './structured-editor-labels';

type Document = typeof documentSchema.Type;

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
