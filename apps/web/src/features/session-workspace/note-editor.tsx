import { RichNoteEditor, RichNoteContent, RichNoteSummary } from '@study/ui/rich-note';
import type { ReactNode } from 'react';

import { useI18n } from '../../lib/i18n';
import { useWorkspacePreferences } from '../../lib/study-client/workspace-preferences.queries';

/** Adapts the shared text editor to the session's bilingual controls. */
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
      label={label ?? t('SessionPageEditor')}
      placeholder={t('SessionPagePlaceholder')}
      labels={labels}
    />
  );
}

export const NoteContent = RichNoteContent;

export const NoteSummary = RichNoteSummary;

export function useNoteLabels() {
  const { t } = useI18n();

  return {
    formatting: t('SessionFormatting'),
    bold: t('SessionFormatBold'),
    italic: t('SessionFormatItalic'),
    underline: t('SessionFormatUnderline'),
    strike: t('SessionFormatStrike'),
    paragraph: t('SessionFormatParagraph'),
    textStyle: t('SessionFormatStyle'),
    clear: t('SessionFormatClear'),
    heading: t('SessionFormatHeading'),
    subheading: t('SessionFormatSubheading'),
    bullets: t('SessionFormatBullets'),
    numbered: t('SessionFormatNumbered'),
    quote: t('SessionFormatQuote'),
    code: t('SessionFormatCode'),
    undo: t('SessionFormatUndo'),
    redo: t('SessionFormatRedo')
  };
}
