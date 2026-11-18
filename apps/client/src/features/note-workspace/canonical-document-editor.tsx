import { documentSchema } from '@study/contracts';
import type { ContentSnapshotId, ProjectId } from '@study/contracts';
import type { RichNoteEditorHandle, RichNoteSelection } from '@study/ui';
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

const equalDocument = Schema.toEquivalence(documentSchema);

/** Adapts the shared editor to Study's canonical, versioned document format. */
export function CanonicalDocumentEditor({
  document,
  snapshotId,
  projectId,
  onChange,
  disabled,
  toolbarEnd,
  targetKey
}: {
  document: EditableDocument;
  snapshotId: ContentSnapshotId;
  projectId?: ProjectId;
  onChange: (document: EditableDocument) => void;
  disabled?: boolean;
  toolbarEnd?: ReactNode;
  targetKey: string | number | bigint;
}) {
  const { t } = useI18n();
  const labels = useStructuredEditorLabels();
  const preferences = useWorkspacePreferences();
  const images = useDocumentEditorImages(document, snapshotId, projectId);
  const value = useMemo(() => documentToEditor(document, images.urls), [document, images.urls]);

  const editor = useRef<RichNoteEditorHandle>(null);
  const captured = useRef<{ document: EditableDocument; selection: RichNoteSelection } | undefined>(
    undefined
  );

  return (
    <>
      {images.subscriptions}
      {images.error && <ContentReadError error={images.error} retry={images.retry} />}
      <StructuredEditor
        ref={editor}
        value={value}
        uploadImage={images.upload}
        onChange={(next) => onChange(editorToDocument(next, document))}
        disabled={disabled}
        spellcheck={preferences.spellcheck}
        fontSize={preferences.editorFontSize}
        toolbarEnd={
          <>
            {toolbarEnd}
            <DictationButton
              targetKey={targetKey}
              disabled={disabled}
              onCaptureStart={() => {
                if (editor.current)
                  captured.current = { document, selection: editor.current.selection() };
              }}
              onTranscript={(text) => {
                editor.current?.restoreSelection(
                  captured.current && equalDocument(captured.current.document, document)
                    ? captured.current.selection
                    : {
                        kind: 'text',
                        anchor: Number.MAX_SAFE_INTEGER,
                        head: Number.MAX_SAFE_INTEGER
                      }
                );
                editor.current?.insertPlainText(text);
              }}
            />
          </>
        }
        label={t('NotePageEditor')}
        placeholder={t('NotePagePlaceholder')}
        labels={labels}
      />
    </>
  );
}
