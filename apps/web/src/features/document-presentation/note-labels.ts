import { useI18n } from '#web/lib/i18n.tsx';

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
