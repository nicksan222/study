import type { RichNoteLabels } from './rich-note';

export type EditorImageReference = { sourceId: string; revision: number; alt: string };

export type StructuredEditorLabels = RichNoteLabels &
  Record<
    | 'contextMenu'
    | 'cut'
    | 'copy'
    | 'paste'
    | 'selectAll'
    | 'clipboardError'
    | 'imageDescription'
    | 'deleteImage'
    | 'saveDescription'
    | 'table'
    | 'insertTable'
    | 'rows'
    | 'columns'
    | 'headerRow'
    | 'cancel'
    | 'addRowBefore'
    | 'addRowAfter'
    | 'deleteRow'
    | 'addColumnBefore'
    | 'addColumnAfter'
    | 'deleteColumn'
    | 'toggleHeaderRow'
    | 'mergeCells'
    | 'splitCell'
    | 'deleteTable'
    | 'image'
    | 'imageFile'
    | 'imageUploading'
    | 'imageError'
    | 'link'
    | 'linkUrl'
    | 'saveLink'
    | 'removeLink'
    | 'invalidLink'
    | 'subscript'
    | 'superscript',
    string
  >;
