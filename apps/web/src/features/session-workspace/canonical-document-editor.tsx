import { StructuredEditor } from '@study/ui/structured-editor';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '../../lib/i18n';
import { useWorkspacePreferences } from '../../lib/study-client/workspace-preferences.queries';
import { documentToEditor, editorToDocument } from './document-editor-content';
import type { EditableDocument } from './document-editor-content';
import { useNoteLabels } from './note-editor';

/** Adapts the shared editor to Study's canonical, versioned document format. */
export function CanonicalDocumentEditor({
  document,
  onChange,
  disabled,
  toolbarEnd
}: {
  document: EditableDocument;
  onChange: (document: EditableDocument) => void;
  disabled?: boolean;
  toolbarEnd?: ReactNode;
}) {
  const { t } = useI18n();
  const labels = useNoteLabels();
  const preferences = useWorkspacePreferences();
  const value = useMemo(() => documentToEditor(document), [document]);

  return (
    <StructuredEditor
      value={value}
      onChange={(next) => onChange(editorToDocument(next, document))}
      disabled={disabled}
      spellcheck={preferences.spellcheck}
      fontSize={preferences.editorFontSize}
      toolbarEnd={toolbarEnd}
      label={t('SessionPageEditor')}
      placeholder={t('SessionPagePlaceholder')}
      labels={labels}
    />
  );
}
