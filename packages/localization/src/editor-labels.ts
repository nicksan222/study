import type { Translate } from './i18n.ts';

export function noteEditorLabels(t: Translate) {
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

export function structuredEditorLabels(t: Translate) {
  const note = noteEditorLabels(t);

  return {
    ...note,
    cancel: t('Cancel'),
    contextMenu: t('PageEditorContextMenu'),
    cut: t('Cut'),
    copy: t('Copy'),
    paste: t('Paste'),
    selectAll: t('SelectAll'),
    clipboardError: t('PageEditorClipboardError'),
    imageDescription: t('PageEditorImageDescription'),
    deleteImage: t('PageEditorDeleteImage'),
    saveDescription: t('PageEditorSaveDescription'),
    table: t('PageEditorTableActions'),
    insertTable: t('PageEditorInsertTable'),
    rows: t('PageEditorRows'),
    columns: t('PageEditorColumns'),
    headerRow: t('PageEditorHeaderRow'),
    addRowBefore: t('PageEditorAddRowBefore'),
    addRowAfter: t('PageEditorAddRowAfter'),
    deleteRow: t('PageEditorDeleteRow'),
    addColumnBefore: t('PageEditorAddColumnBefore'),
    addColumnAfter: t('PageEditorAddColumnAfter'),
    deleteColumn: t('PageEditorDeleteColumn'),
    toggleHeaderRow: t('PageEditorToggleHeaderRow'),
    mergeCells: t('PageEditorMergeCells'),
    splitCell: t('PageEditorSplitCell'),
    deleteTable: t('PageEditorDeleteTable'),
    image: t('PageEditorAddImage'),
    imageFile: t('PageEditorImageFile'),
    imageUploading: t('PageEditorImageUploading'),
    imageError: t('PageEditorImageError'),
    link: t('PageEditorLink'),
    linkUrl: t('PageEditorLinkUrl'),
    saveLink: t('PageEditorSaveLink'),
    removeLink: t('PageEditorRemoveLink'),
    invalidLink: t('PageEditorInvalidLink'),
    subscript: t('PageEditorSubscript'),
    superscript: t('PageEditorSuperscript')
  };
}
