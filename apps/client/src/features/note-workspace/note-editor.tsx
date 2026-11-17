import { RichNoteEditor, RichNoteContent, RichNoteSummary } from '@study/ui';
import type { RichNoteEditorHandle } from '@study/ui';
import type { Ref, ReactNode } from 'react';

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
  toolbarEnd
}: {
  ref?: Ref<RichNoteEditorHandle>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  toolbarEnd?: ReactNode;
}) {
  const { t } = useI18n();
  const labels = useNoteLabels();
  const preferences = useWorkspacePreferences();

  return (
    <RichNoteEditor
      ref={ref}
      toolbarEnd={toolbarEnd}
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
