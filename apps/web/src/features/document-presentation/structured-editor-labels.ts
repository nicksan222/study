import type { StructuredEditorLabels } from '@study/ui/structured-editor';

import { useI18n } from '#web/lib/i18n.tsx';

import { useNoteLabels } from './note-labels';

export function useStructuredEditorLabels(): StructuredEditorLabels {
  const { t } = useI18n();
  const note = useNoteLabels();

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
