import { RichNoteEditor, RichNoteContent, RichNoteSummary } from '@study/ui';
import type { RichNoteEditorHandle } from '@study/ui';
import { useRef } from 'react';
import type { Ref, ReactNode } from 'react';

import { DictationButton } from '#client/features/voice/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { useNoteLabels } from '../document-presentation';
import { useEditorDictation } from './use-editor-dictation';

/** Adapts the shared text editor to the note's bilingual controls. */
export function NoteEditor({
  ref,
  value,
  onChange,
  disabled,
  label,
  toolbarEnd,
  targetKey
}: {
  ref?: Ref<RichNoteEditorHandle>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  toolbarEnd?: ReactNode;
  targetKey: string | number | bigint;
}) {
  const { t } = useI18n();
  const labels = useNoteLabels();
  const preferences = useWorkspacePreferences();

  const editor = useRef<RichNoteEditorHandle>(null);
  const dictation = useEditorDictation(editor, value);

  return (
    <RichNoteEditor
      ref={(handle) => {
        editor.current = handle;

        if (typeof ref === 'function') ref(handle);
        else if (ref) ref.current = handle;
      }}
      toolbarEnd={
        <>
          {toolbarEnd}
          <DictationButton targetKey={targetKey} disabled={disabled} {...dictation} />
        </>
      }
      value={value}
      onChange={onChange}
      disabled={disabled}
      spellcheck={preferences.spellcheck}
      fontSize={preferences.editorFontSize}
      label={label ?? t('NotePageEditor')}
      placeholder={t('NotePagePlaceholder')}
      labels={labels}
    />
  );
}

export const NoteContent = RichNoteContent;

export const NoteSummary = RichNoteSummary;
