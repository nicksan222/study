import { documentSchema } from '@study/contracts';
import type { ContentSnapshotId } from '@study/contracts';
import type { RichNoteEditorHandle } from '@study/ui';
import { StructuredEditor } from '@study/ui';
import { Schema } from 'effect';
import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';

import { DictationButton } from '#client/features/voice/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { ContentReadError } from '../document-presentation';
import {
  documentToEditor,
  editorToDocument,
  useDocumentEditorImages,
  useStructuredEditorLabels
} from '../document-presentation';
import type { EditableDocument } from '../document-presentation';
import { useEditorDictation } from './use-editor-dictation';

const equalDocument = Schema.toEquivalence(documentSchema);

/** Adapts the shared editor to Study's canonical, versioned document format. */
export function CanonicalDocumentEditor({
  document,
  snapshotId,
  onChange,
  disabled,
  toolbarEnd,
  targetKey
}: {
  document: EditableDocument;
  snapshotId: ContentSnapshotId;
  onChange: (document: EditableDocument) => void;
  disabled?: boolean;
  toolbarEnd?: ReactNode;
  targetKey: string | number | bigint;
}) {
  const { t } = useI18n();
  const labels = useStructuredEditorLabels();
  const preferences = useWorkspacePreferences();
  const images = useDocumentEditorImages(document, snapshotId);
  const value = useMemo(() => documentToEditor(document, images.urls), [document, images.urls]);

  const editor = useRef<RichNoteEditorHandle>(null);
  const dictation = useEditorDictation(editor, document, equalDocument);

  return (
    <>
      {images.subscriptions}
      {images.error && <ContentReadError error={images.error} retry={images.retry} />}
      <StructuredEditor
        ref={editor}
        value={value}
        onChange={(next) => onChange(editorToDocument(next, document))}
        disabled={disabled}
        spellcheck={preferences.spellcheck}
        fontSize={preferences.editorFontSize}
        toolbarEnd={
          <>
            {toolbarEnd}
            <DictationButton targetKey={targetKey} disabled={disabled} {...dictation} />
          </>
        }
        label={t('NotePageEditor')}
        placeholder={t('NotePagePlaceholder')}
        labels={labels}
      />
    </>
  );
}
