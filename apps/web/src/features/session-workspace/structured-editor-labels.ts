import type { StructuredEditorLabels } from '@study/ui/structured-editor';

import { useI18n } from '#web/lib/i18n.tsx';

import { useNoteLabels } from './note-editor';

export function useStructuredEditorLabels(): StructuredEditorLabels {
  const { t } = useI18n();
  const note = useNoteLabels();

  return {
    ...note,
    cancel: t('Cancel'),
    contextMenu: t('DocumentEditorContextMenu'),
    cut: t('Cut'),
    copy: t('Copy'),
    paste: t('Paste'),
    selectAll: t('SelectAll'),
    clipboardError: t('DocumentEditorClipboardError'),
    imageDescription: t('DocumentEditorImageDescription'),
    deleteImage: t('DocumentEditorDeleteImage'),
    saveDescription: t('DocumentEditorSaveDescription'),
    table: t('DocumentEditorTableActions'),
    insertTable: t('DocumentEditorInsertTable'),
    rows: t('DocumentEditorRows'),
    columns: t('DocumentEditorColumns'),
    headerRow: t('DocumentEditorHeaderRow'),
    addRowBefore: t('DocumentEditorAddRowBefore'),
    addRowAfter: t('DocumentEditorAddRowAfter'),
    deleteRow: t('DocumentEditorDeleteRow'),
    addColumnBefore: t('DocumentEditorAddColumnBefore'),
    addColumnAfter: t('DocumentEditorAddColumnAfter'),
    deleteColumn: t('DocumentEditorDeleteColumn'),
    toggleHeaderRow: t('DocumentEditorToggleHeaderRow'),
    mergeCells: t('DocumentEditorMergeCells'),
    splitCell: t('DocumentEditorSplitCell'),
    deleteTable: t('DocumentEditorDeleteTable'),
    image: t('DocumentEditorAddImage'),
    imageFile: t('DocumentEditorImageFile'),
    imageUploading: t('DocumentEditorImageUploading'),
    imageError: t('DocumentEditorImageError'),
    link: t('DocumentEditorLink'),
    linkUrl: t('DocumentEditorLinkUrl'),
    saveLink: t('DocumentEditorSaveLink'),
    removeLink: t('DocumentEditorRemoveLink'),
    invalidLink: t('DocumentEditorInvalidLink'),
    subscript: t('DocumentEditorSubscript'),
    superscript: t('DocumentEditorSuperscript')
  };
}
