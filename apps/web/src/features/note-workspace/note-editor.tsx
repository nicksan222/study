import { RichNoteEditor, RichNoteContent, RichNoteSummary } from '@study/ui/rich-note';
import type { ReactNode } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';
import { useWorkspacePreferences } from '#web/lib/study-client/workspace-preferences.queries.ts';

/** Adapts the shared text editor to the note's bilingual controls. */
export function NoteEditor({
  value,
  onChange,
  disabled,
  label,
  toolbarEnd
}: {
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

export function useNoteLabels() {
  const { t } = useI18n();

  return {
    formatting: t('NoteFormatting'),
    bold: t('NoteFormatBold'),
    italic: t('NoteFormatItalic'),
    underline: t('NoteFormatUnderline'),
    strike: t('NoteFormatStrike'),
    paragraph: t('NoteFormatParagraph'),
    textStyle: t('NoteFormatStyle'),
    clear: t('NoteFormatClear'),
    heading: t('NoteFormatHeading'),
    subheading: t('NoteFormatSubheading'),
    bullets: t('NoteFormatBullets'),
    numbered: t('NoteFormatNumbered'),
    quote: t('NoteFormatQuote'),
    code: t('NoteFormatCode'),
    undo: t('NoteFormatUndo'),
    redo: t('NoteFormatRedo')
  };
}
