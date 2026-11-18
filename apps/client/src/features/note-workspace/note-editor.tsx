import { RichNoteEditor, RichNoteContent, RichNoteSummary } from '@study/ui';
import type { RichNoteEditorHandle, RichNoteSelection } from '@study/ui';
import { useRef } from 'react';
import type { Ref, ReactNode } from 'react';

import { DictationButton } from '#client/features/voice/index.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { useWorkspacePreferences } from '#client/lib/study-client/workspace-preferences.queries.ts';

import { useNoteLabels } from '../document-presentation';

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
  const captured = useRef<{ value: string; selection: RichNoteSelection } | undefined>(undefined);

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
          <DictationButton
            targetKey={targetKey}
            disabled={disabled}
            onCaptureStart={() => {
              if (editor.current)
                captured.current = { value, selection: editor.current.selection() };
            }}
            onTranscript={(text) => {
              const selection: RichNoteSelection =
                captured.current?.value === value
                  ? captured.current.selection
                  : {
                      kind: 'text',
                      anchor: Number.MAX_SAFE_INTEGER,
                      head: Number.MAX_SAFE_INTEGER
                    };

              editor.current?.restoreSelection(selection);
              editor.current?.insertPlainText(text);
            }}
          />
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
