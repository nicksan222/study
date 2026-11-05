import type { ContentSnapshotId, ProjectId } from '@study/contracts/ids';
import { StructuredEditor } from '@study/ui/structured-editor';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { useWorkspacePreferences } from '#web/lib/study-client/workspace-preferences.queries.ts';

import { ContentReadError } from '../document-presentation';
import { documentToEditor, editorToDocument } from './document-editor-content';
import type { EditableDocument } from './document-editor-content';
import { useDocumentEditorImages } from './editor-images.queries';
import { useStructuredEditorLabels } from './structured-editor-labels';

/** Adapts the shared editor to Study's canonical, versioned document format. */
export function CanonicalDocumentEditor({
  document,
  snapshotId,
  projectId,
  onChange,
  disabled,
  toolbarEnd
}: {
  document: EditableDocument;
  snapshotId: ContentSnapshotId;
  projectId?: ProjectId;
  onChange: (document: EditableDocument) => void;
  disabled?: boolean;
  toolbarEnd?: ReactNode;
}) {
  const { t } = useI18n();
  const labels = useStructuredEditorLabels();
  const preferences = useWorkspacePreferences();
  const images = useDocumentEditorImages(document, snapshotId, projectId);
  const value = useMemo(() => documentToEditor(document, images.urls), [document, images.urls]);

  return (
    <>
      {images.error && <ContentReadError error={images.error} retry={images.retry} />}
      <StructuredEditor
        value={value}
        uploadImage={images.upload}
        onChange={(next) => onChange(editorToDocument(next, document))}
        disabled={disabled}
        spellcheck={preferences.spellcheck}
        fontSize={preferences.editorFontSize}
        toolbarEnd={toolbarEnd}
        label={t('SessionPageEditor')}
        placeholder={t('SessionPagePlaceholder')}
        labels={labels}
      />
    </>
  );
}
